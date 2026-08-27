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
  const activeAlerts = (data.alerts ?? []).filter(
    alert => alert.level === 'warning' || alert.level === 'critical'
  ).length;

  return NextResponse.json(
    {
      status: activeAlerts > 0 ? 'degraded' : 'operational',
      activeAlerts,
      uptime: data.uptime,
      cpu: Math.round(data.cpu.usage),
      memory: Math.round(data.memory.percentage),
      disk: Math.round(data.disk.percentage),
      load1: data.load?.avg1 ?? null,
      timestamp: new Date().toISOString()
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
