import React from 'react';
import Link from 'next/link';
import { AlignLeft, Shield, TerminalSquare, TrendingUp, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ALERT_LEVEL_COLORS } from '@/lib/statusColors';
import { DashboardData } from '@/utils/dashboardData';
import { formatBytes, formatRelativeTime } from '@/utils/format';

import { Card, Empty } from './shared';

const MAX_ALERTS = 5;
const MAX_PROCESSES = 6;
const MAX_SESSIONS = 4;
const MAX_PEERS = 4;

export const AlertsCard: React.FC<{ data: DashboardData; now: number | null }> = ({ data, now }) => (
  <Card icon={TriangleAlert} color="#f87171" title="ALERTS LOG">
    {data.alerts.length === 0 && <Empty>no alerts recorded</Empty>}
    <ul className="dash-rows">
      {data.alerts.slice(0, MAX_ALERTS).map(alert => (
        <li key={alert.id} className="t-body flex justify-between gap-2">
          <span className="truncate" style={{ color: ALERT_LEVEL_COLORS[alert.level] ?? '#9ca3af' }}>
            {alert.message}
          </span>
          <span className="shrink-0 text-gray-500">
            {now === null ? '' : formatRelativeTime(alert.at, now)}
          </span>
        </li>
      ))}
    </ul>
    <Link href="/alerts" className="t-label mt-1 block text-right text-gray-500 hover:text-gray-300">
      full history →
    </Link>
  </Card>
);

export const ProcessesCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  // Toggle the list between CPU-sorted (default) and memory-sorted. The
  // memory-sorted list comes from a separate ps call surfaced by the API.
  const [sortBy, setSortBy] = React.useState<'cpu' | 'mem'>('cpu');
  const source = sortBy === 'mem' ? data.topProcessesByMemory : data.processes;
  const processes = source.filter(p => p.cpu > 0 || p.memory > 0).slice(0, MAX_PROCESSES);
  const { total, zombie } = data.processSummary;

  // Summarise the whole process table in the header (the list stays top-N).
  // Zombies are shown in red — a sign of a process leak.
  const summary = (
    <span className="flex shrink-0 items-center gap-2">
      {total > 0 && (
        <span className="t-micro font-mono text-gray-500">
          {total} proc{zombie > 0 && <span className="text-red-400"> · {zombie}Z</span>}
        </span>
      )}
      <span className="t-micro flex overflow-hidden rounded border border-gray-700 font-mono">
        {(['cpu', 'mem'] as const).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setSortBy(key)}
            className={cn(
              'px-1 uppercase',
              sortBy === key ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            )}
            aria-pressed={sortBy === key}
          >
            {key === 'cpu' ? 'CPU' : 'MEM'}
          </button>
        ))}
      </span>
    </span>
  );

  return (
    <Card icon={AlignLeft} color="#fb923c" title="TOP PROCESSES" right={summary}>
      <div className="t-micro mb-0.5 flex items-center justify-between text-gray-500">
        <span>Name</span>
        <div className="flex gap-2">
          <span
            className={cn('w-[5ch] text-right', sortBy === 'cpu' ? 'text-amber-400' : 'text-amber-400/60')}
          >
            CPU
          </span>
          <span className={cn('w-[5ch] text-right', sortBy === 'mem' ? 'text-sky-400' : 'text-sky-400/60')}>
            RAM
          </span>
        </div>
      </div>
      {processes.length === 0 && <Empty>process list unavailable</Empty>}
      <ul className="dash-rows">
        {processes.map(process => (
          <li key={process.id} className="t-body flex items-center justify-between gap-2">
            {/* Putting the tooltip on a truncated element clips it to that
                element's overflow:hidden, so the un-truncated outer span owns
                the tooltip. The full name stays in the DOM text, so a screen
                reader reads it regardless of truncation. */}
            <span className="dash-tip min-w-0" tabIndex={-1} data-tip={process.name}>
              <span className="block truncate text-gray-400">{process.name}</span>
            </span>
            <div className="flex shrink-0 gap-2 font-mono">
              <span className="w-[5ch] text-right text-amber-400">{process.cpu.toFixed(1)}</span>
              <span className="w-[5ch] text-right text-sky-400">{process.memory.toFixed(1)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export const SshCard: React.FC<{ data: DashboardData; now: number | null }> = ({ data, now }) => (
  <Card icon={TerminalSquare} color="#38bdf8" title="SSH SESSIONS">
    {data.security.sshSessions.length === 0 && <Empty>no remote sessions</Empty>}
    <ul className="dash-rows">
      {data.security.sshSessions.slice(0, MAX_SESSIONS).map(session => (
        <li
          key={`${session.user}@${session.ip}@${session.since}`}
          className="t-body flex items-center justify-between gap-2"
        >
          <span className="min-w-0 truncate text-gray-400">
            {session.user}@{session.ip}
          </span>
          <span className="shrink-0 text-gray-500">
            {now === null ? '' : formatRelativeTime(session.since, now)}
          </span>
        </li>
      ))}
    </ul>
  </Card>
);

export const TrafficCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Card icon={TrendingUp} color="#38bdf8" title="TOP TRAFFIC IPS">
    {data.security.topTraffic.length === 0 && <Empty>no external connections</Empty>}
    <ul className="dash-rows">
      {data.security.topTraffic.slice(0, MAX_PEERS).map(peer => (
        <li key={peer.ip} className="t-body flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-gray-400">{peer.ip}</span>
          {/* On a kernel where conntrack doesn't count bytes, only the connection count is known. */}
          <span className="shrink-0 font-mono text-sky-400">
            {peer.bytes === null ? `${peer.connections} conn` : formatBytes(peer.bytes)}
          </span>
        </li>
      ))}
    </ul>
  </Card>
);

export const FirewallCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { firewall } = data.security;
  const color =
    firewall.status === 'active' ? '#4ade80' : firewall.status === 'inactive' ? '#f87171' : '#9ca3af';

  return (
    <Card
      icon={Shield}
      color={color}
      title="FIREWALL"
      right={
        <span className="t-label shrink-0 whitespace-nowrap" style={{ color }}>
          {firewall.backend ? `${firewall.backend} · ${firewall.status}` : firewall.status}
        </span>
      }
    >
      <p className="t-body text-gray-400">
        Blocked (24h):{' '}
        <span className="font-mono text-red-400">
          {firewall.blockedAttempts === null ? 'N/A' : firewall.blockedAttempts.toLocaleString()}
        </span>
      </p>
    </Card>
  );
};
