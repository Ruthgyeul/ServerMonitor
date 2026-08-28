import { NextResponse } from 'next/server';

import { getSystemInfo } from '@/utils/systemMonitor';
import { enforceRateLimit } from '@/utils/rateLimit';

// A deliberately public, sanitised status endpoint for the /status page — an
// uptime-style summary safe to share externally. It exposes only coarse health
// (a status word, rounded CPU/memory/disk, uptime, an active-alert COUNT) and
// never any reconnaissance data: no IPs, process names, ports, alert messages,
// firewall or SSH detail. It stays outside the proxy token gate on purpose so a
// public status page works even when /api/system is locked down.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const data = await getSystemInfo();
  const warnings = data.warnings ?? [];
  const collectorFailed = (name: string) => warnings.some(warning => warning.startsWith(`${name}:`));

  // Derive "active" from CURRENT metric conditions, not the persisted alert log
  // (which retains earlier warning/critical entries after a rule recovers and
  // would otherwise pin the page to "degraded" indefinitely).
  const temperature = data.cpu.temperature;
  const conditions = [
    data.cpu.usage > 85,
    data.memory.percentage > 90,
    data.disk.percentage > 90,
    typeof temperature === 'number' && temperature > 74,
    (data.swap?.total ?? 0) > 0 && (data.swap?.percentage ?? 0) > 80,
    data.security?.firewall.status === 'inactive',
    (data.readOnlyMounts?.length ?? 0) > 0,
    (data.services?.failed ?? 0) > 0,
    (data.smart ?? []).some(drive => drive.healthy === false)
  ];
  const activeAlerts = conditions.filter(Boolean).length;

  // A failed core collector returns a zero-filled fallback; treat that as
  // unavailable telemetry (report the metric as null and degrade), not a healthy 0.
  const cpuFailed = collectorFailed('cpu.usage') || collectorFailed('cpu');
  const memFailed = collectorFailed('memory');
  const diskFailed = collectorFailed('disk');
  const coreUnavailable = cpuFailed || memFailed || diskFailed;

  return NextResponse.json(
    {
      status: coreUnavailable || activeAlerts > 0 ? 'degraded' : 'operational',
      activeAlerts,
      uptime: data.uptime,
      cpu: cpuFailed ? null : Math.round(data.cpu.usage),
      memory: memFailed ? null : Math.round(data.memory.percentage),
      disk: diskFailed ? null : Math.round(data.disk.percentage),
      timestamp: new Date().toISOString()
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
