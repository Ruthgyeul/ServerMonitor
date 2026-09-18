import { NextResponse } from 'next/server';

import { getSystemInfo } from '@/utils/systemMonitor';
import { enforceRateLimit } from '@/utils/rateLimit';

// A deliberately public, sanitised status endpoint for the /status page — an
// uptime-style summary safe to share externally. It exposes only coarse health
// (a status word, rounded CPU/memory/disk/GPU/load-avg, outbound ping
// latency, uptime, an active-alert COUNT) and never any reconnaissance data:
// no IPs, process names, ports, alert messages, firewall or SSH detail, GPU
// model name, or core count. Every field is hand-picked from getSystemInfo()
// — never spread a whole sub-object into this response, since that's exactly
// how a field like gpu.name would leak in unnoticed. It stays outside the
// auth gate on purpose so a public status page works even when /api/system
// is locked down.

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
  const gpuFailed = collectorFailed('gpu');
  const pingFailed = collectorFailed('network.ping') || collectorFailed('network');
  const coreUnavailable = cpuFailed || memFailed || diskFailed;

  return NextResponse.json(
    {
      status: coreUnavailable || activeAlerts > 0 ? 'degraded' : 'operational',
      activeAlerts,
      uptime: data.uptime,
      cpu: cpuFailed ? null : Math.round(data.cpu.usage),
      memory: memFailed ? null : Math.round(data.memory.percentage),
      disk: diskFailed ? null : Math.round(data.disk.percentage),
      // 'N/A' (no GPU present) is a legitimate reading, distinct from a
      // collector failure (null) — mirrors getGpuInfo()'s own convention.
      // Only .usage is read, never the whole gpu object (gpu.name is a
      // hardware fingerprint that must not leak on a public endpoint).
      gpu: gpuFailed ? null : typeof data.gpu?.usage === 'number' ? Math.round(data.gpu.usage) : 'N/A',
      // Outbound latency to PING_HOST only — reveals nothing about this
      // server's own network topology (see getPing() in systemMonitor.ts).
      ping: pingFailed ? null : Math.round(data.network.ping * 10) / 10,
      // avg1 only; 5m/15m are omitted rather than adding tile clutter.
      loadAvg: typeof data.load?.avg1 === 'number' ? Math.round(data.load.avg1 * 100) / 100 : null,
      timestamp: new Date().toISOString()
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
