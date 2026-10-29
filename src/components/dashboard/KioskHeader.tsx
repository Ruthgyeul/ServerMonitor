import React from 'react';
import { Server, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { COLORS } from '@/lib/statusColors';
import { DashboardData } from '@/utils/dashboardData';
import { formatClock, shortKernel } from '@/utils/format';

// Header and alert bar for the /monitor kiosk layout (the console pages use the
// shell header instead). Rebuilt on the console design with the kiosk in Phase 2.

// Pick only "a problem right now" worth showing in the banner. Past events are handled by the ALERTS LOG.
function currentAlerts(data: DashboardData): string[] {
  const alerts: string[] = [];

  if (data.cpu.usage > 85) alerts.push(`CPU ${data.cpu.usage.toFixed(1)}%`);
  if (data.memory.percentage > 90) alerts.push(`RAM ${data.memory.percentage.toFixed(1)}%`);
  if (data.disk.percentage > 90) alerts.push(`Disk ${data.disk.percentage.toFixed(1)}%`);
  if (data.cpu.temperature !== 'N/A' && data.cpu.temperature > 74) {
    alerts.push(`Temp ${data.cpu.temperature.toFixed(1)}°C`);
  }
  if (data.swap.total > 0 && data.swap.percentage > 80) alerts.push('Swap high');
  if (data.security.firewall.status === 'inactive') alerts.push('Firewall inactive');
  // New 2.3 health signals.
  if (data.readOnlyMounts.length > 0) alerts.push(`${data.readOnlyMounts.length} read-only mount`);
  if (data.services.failed && data.services.failed > 0) alerts.push(`${data.services.failed} service failed`);
  if (data.smart.some(drive => drive.healthy === false)) alerts.push('SMART failing');

  return alerts;
}

interface HeaderProps {
  data: DashboardData;
  connected: boolean;
  lastUpdate: number | null;
  now: number | null;
}

// Not built on the shared TerminalHeaderBar (common/TerminalWindow.tsx) — this
// carries a live clock, a 3-state connection dot, a "degraded collectors"
// tooltip badge, and a responsive hostname/OS/kernel line, none of which fit
// that component's single `right` slot without contorting its API for this
// one caller. TerminalHeaderBar stays the simple title+right-slot version
// used by the content pages (alerts/cluster/login/status).
export const Header: React.FC<HeaderProps> = ({ data, connected, lastUpdate, now }) => {
  const secondsAgo =
    now !== null && lastUpdate !== null ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : 0;
  // The connection may be alive while the values are stuck (a stalled collection
  // loop, etc.). Independent of SSE connected, show amber when the last successful sample is old.
  const stale = connected && secondsAgo > 5;
  // The warnings the API returns hold which collectors failed. They weren't shown
  // on screen before — show how many degraded as a badge, with the list in a hover tooltip.
  const degraded = data.warnings.length;

  return (
    <header className="dash-head sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-700 bg-gray-800/95 backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Server size={16} color="#38bdf8" strokeWidth={2} className="shrink-0" />
        <span className="t-value shrink-0 font-bold text-emerald-400 select-none">❯</span>
        <h1 className="t-value truncate font-bold">Server Monitor</h1>
        <div className="h-[7px] w-[7px] shrink-0 animate-[pulseDot_2s_ease-in-out_infinite] rounded-full bg-emerald-400" />
      </div>

      {/* Don't render the time before mount (avoids a hydration mismatch). */}
      <span className="t-body order-1 whitespace-nowrap font-mono text-gray-300 md:order-3">
        {now === null ? ' ' : formatClock(new Date(now))}
      </span>

      {/* On a narrow screen, w-full drops this whole group onto a second row.
          On a wide screen it sits inline before the clock. */}
      <div className="order-2 flex w-full items-center justify-between gap-3 md:order-2 md:w-auto md:justify-end">
        <div className="flex shrink-0 items-center gap-1">
          <div
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connected
                ? 'animate-[pulseDot_2s_ease-in-out_infinite] bg-emerald-400'
                : 'animate-[pulseDot_0.6s_ease-in-out_infinite] bg-red-400'
            )}
          />
          <span
            className={cn(
              't-label',
              !connected ? 'text-red-400' : stale ? 'text-amber-400' : 'text-gray-400'
            )}
          >
            {connected ? `Live · updated ${secondsAgo}s ago` : 'Reconnecting…'}
          </span>
        </div>

        {degraded > 0 && (
          <span
            className="dash-tip t-label flex shrink-0 items-center gap-1 text-amber-400"
            tabIndex={-1}
            data-tip={data.warnings.join(' · ')}
          >
            <TriangleAlert className="dash-icon shrink-0" color={COLORS.warn} strokeWidth={2} />
            {degraded} degraded
          </span>
        )}

        <span className="t-micro min-w-0 truncate font-mono text-gray-500">
          {data.host.hostname} · {data.host.os}
          {data.host.os.includes(shortKernel(data.host.kernel)) ? '' : ` · ${shortKernel(data.host.kernel)}`}
          {data.host.virtualization ? ` · ${data.host.virtualization}` : ''}
        </span>
      </div>
    </header>
  );
};

export const AlertBar: React.FC<{ data: DashboardData }> = ({ data }) => {
  const alerts = currentAlerts(data);
  const hasAlert = alerts.length > 0;
  const color = hasAlert ? '#f87171' : '#4ade80';

  return (
    <div
      className={cn(
        'dash-alertbar flex items-center gap-1.5 border-b border-gray-700',
        hasAlert && 'animate-[alertBlink_1.2s_ease-in-out_infinite]'
      )}
      style={{ background: hasAlert ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.08)' }}
    >
      <TriangleAlert className="dash-icon shrink-0" color={color} strokeWidth={2} />
      <span className="t-body truncate" style={{ color }}>
        {hasAlert ? `Warning: ${alerts.join(' · ')}` : 'All systems normal'}
      </span>
    </div>
  );
};
