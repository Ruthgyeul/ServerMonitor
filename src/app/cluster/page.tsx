'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  Cpu,
  Fan,
  HardDrive,
  LucideIcon,
  MemoryStick,
  Network,
  Server,
  Thermometer,
  TriangleAlert
} from 'lucide-react';

import { Gauge, Sparkline } from '@/components/dashboard/primitives';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { NetworkHistoryEntry, ServerData } from '@/types/system';
import { formatClock, formatRate } from '@/utils/format';
import { COLORS, statusColor, tempColor } from '@/utils/statusColors';

// This page uses the same terminal design as the main dashboard
// (src/app/page.tsx) but lays out several cluster nodes side by side instead of
// one host. It used to poll each node's /api/system directly from the browser;
// now the same-origin /api/cluster aggregates the nodes server-side and returns
// only a compact result — node IPs aren't exposed to the client, and there's no
// need to open CORS per node.

// Refresh every second — the same polling cadence as the main dashboard.
const POLL_INTERVAL_MS = 1000;
// The span the sparkline covers. The last 30 seconds per node.
const MAX_NETWORK_POINTS = 30;

type NodeResult = { ok: true; data: ServerData } | { ok: false; error: string };

// The per-node shape /api/cluster returns. No IP, only a display host label.
interface ClusterNode {
  name: string;
  host: string;
  type: 'intel' | 'rpi';
  result: NodeResult;
}

export default function ClusterPage() {
  // null = before the first response (connecting), [] = the server confirmed there are no nodes.
  const [nodes, setNodes] = useState<ClusterNode[] | null>(null);
  const [networkHistory, setNetworkHistory] = useState<Record<string, NetworkHistoryEntry[]>>({});
  const now = useNow();

  const refresh = useCallback(async () => {
    let received: ClusterNode[] = [];
    try {
      const response = await fetch('/api/cluster', { cache: 'no-store' });
      if (response.ok) {
        const payload = (await response.json()) as { nodes: ClusterNode[] };
        received = payload.nodes ?? [];
      }
    } catch {
      // If the aggregation endpoint is unreachable, keep the last value (don't blank the screen).
      return;
    }
    setNodes(received);

    // Append the instantaneous throughput for the sparkline to each node's
    // history. Trimming on insert means no separate cleanup timer is needed.
    // There's no IP, so the name is used as the key.
    const time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    setNetworkHistory(prev => {
      const updated = { ...prev };
      for (const node of received) {
        if (!node.result.ok) continue;
        const point: NetworkHistoryEntry = {
          time,
          download: node.result.data.network?.download ?? 0,
          upload: node.result.data.network?.upload ?? 0
        };
        updated[node.name] = [...(updated[node.name] ?? []), point].slice(-MAX_NETWORK_POINTS);
      }
      return updated;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!cancelled) await refresh();
    };
    start();

    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  const onlineCount = (nodes ?? []).filter(node => node.result.ok).length;
  const total = nodes?.length ?? 0;

  return (
    <div className="terminal-bg min-h-screen text-gray-100">
      <TerminalTitleBar />
      <ClusterHeader online={onlineCount} total={total} now={now} />

      {nodes !== null && nodes.length === 0 ? (
        <EmptyCluster />
      ) : (
        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {(nodes ?? []).map(node => (
            <ServerCard key={node.name} node={node} history={networkHistory[node.name] ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Top chrome / header ---------------------------------------------------

// The same terminal-window chrome as the main dashboard. Only the path changes to the cluster one.
const TerminalTitleBar: React.FC = () => (
  <div className="term-titlebar">
    <div className="flex shrink-0 items-center gap-[7px]">
      <span className="term-dot" style={{ background: '#ff5f56' }} />
      <span className="term-dot" style={{ background: '#ffbd2e' }} />
      <span className="term-dot" style={{ background: '#27c93f' }} />
    </div>
    <span className="min-w-0 flex-1 truncate text-center font-mono">
      <span style={{ color: '#34d399' }}>root@cluster</span>
      <span style={{ color: '#5c6478' }}> — ~/monitor/cluster — </span>
      <span style={{ color: '#8b93a7' }}>zsh</span>
    </span>
    <span className="shrink-0 font-mono text-gray-500">⎇ main</span>
  </div>
);

interface ClusterHeaderProps {
  online: number;
  total: number;
  now: number | null;
}

const ClusterHeader: React.FC<ClusterHeaderProps> = ({ online, total, now }) => {
  const allUp = total > 0 && online === total;

  return (
    <header className="dash-head sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-700 bg-gray-800/95 backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Server size={16} color="#38bdf8" strokeWidth={2} className="shrink-0" />
        <span className="t-value shrink-0 font-bold text-emerald-400 select-none">❯</span>
        <h1 className="t-value truncate font-bold">Cluster Monitor</h1>
        <div className="h-[7px] w-[7px] shrink-0 animate-[pulseDot_2s_ease-in-out_infinite] rounded-full bg-green-400" />
      </div>

      {/* Don't render the time before mount (avoids a hydration mismatch). */}
      <span className="t-body order-1 whitespace-nowrap font-mono text-gray-300 md:order-3">
        {now === null ? ' ' : formatClock(new Date(now))}
      </span>

      <div className="order-2 flex w-full items-center justify-between gap-3 md:order-2 md:w-auto md:justify-end">
        <div className="flex shrink-0 items-center gap-1">
          <div
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              allUp
                ? 'animate-[pulseDot_2s_ease-in-out_infinite] bg-green-400'
                : 'animate-[pulseDot_0.6s_ease-in-out_infinite] bg-red-400'
            )}
          />
          <span className={cn('t-label', allUp ? 'text-gray-400' : 'text-red-400')}>
            {online}/{total} nodes online
          </span>
        </div>
      </div>
    </header>
  );
};

const EmptyCluster: React.FC = () => (
  <div className="flex flex-col items-center justify-center gap-2 p-16 text-center">
    <TriangleAlert size={20} color={COLORS.warn} strokeWidth={2} />
    <p className="t-body text-gray-300">No cluster nodes configured</p>
    <p className="t-micro max-w-[420px] text-gray-500">
      Set NEXT_PUBLIC_CLUSTER_SERVERS in your environment to list the nodes to monitor.
    </p>
  </div>
);

// --- Node card -------------------------------------------------------------

interface ServerCardProps {
  node: ClusterNode;
  history: NetworkHistoryEntry[];
}

const ServerCard: React.FC<ServerCardProps> = ({ node, history }) => {
  const { result } = node;

  // On a connection failure, show the reason. Like the main dashboard keeping
  // its last value, the frame is always drawn here too.
  if (!result.ok) {
    return (
      <ServerShell name={node.name} host={node.host} status="offline">
        <p className="t-body text-red-400">{result.error}</p>
      </ServerShell>
    );
  }

  const { cpu, memory, disk, network, uptime, fan } = result.data;
  const toGb = (mb: number) => (mb / 1024).toFixed(1);

  // For fan, use the first connector that has a value (the position varies by motherboard).
  const rpm = [fan.cpu, fan.case1, fan.case2].find(value => value > 0) ?? 0;
  // cpu.temperature is the representative CPU temperature, filled regardless of architecture.
  const temperature = cpu.temperature;
  const topProcess = result.data.processes.find(process => process.cpu > 0 || process.memory > 0);

  return (
    <ServerShell name={node.name} host={node.host} status="online">
      <div className="grid grid-cols-3 gap-2">
        <MiniGauge
          icon={Cpu}
          iconColor="#60a5fa"
          label="CPU"
          percentage={cpu.usage}
          caption={`${cpu.cores}c`}
        />
        <MiniGauge
          icon={MemoryStick}
          iconColor="#4ade80"
          label="RAM"
          percentage={memory.percentage}
          caption={`${toGb(memory.used)}/${toGb(memory.total)}G`}
        />
        <MiniGauge
          icon={HardDrive}
          iconColor="#facc15"
          label="DISK"
          percentage={disk.percentage}
          caption={`${disk.used.toFixed(0)}/${disk.total.toFixed(0)}G`}
        />
      </div>

      <div className="mt-2">
        <div className="t-micro mb-0.5 flex items-center justify-between gap-2 text-gray-400">
          <span className="flex items-center gap-1">
            <Network className="dash-icon shrink-0" color="#22d3ee" strokeWidth={2} />
            NET
          </span>
          <span className="whitespace-nowrap font-mono">
            <span className="text-blue-400">↓ {formatRate(network.download)}</span>{' '}
            <span className="text-emerald-400">↑ {formatRate(network.upload)}</span>
          </span>
        </div>
        <div className="dash-spark">
          <Sparkline
            series={[
              { key: 'download', values: history.map(point => point.download), color: '#60a5fa' },
              { key: 'upload', values: history.map(point => point.upload), color: '#34d399' }
            ]}
          />
        </div>
      </div>

      <div className="t-micro mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-700 pt-1.5">
        <InfoItem
          icon={Thermometer}
          color={tempColor(temperature)}
          value={temperature === 'N/A' ? 'N/A' : `${temperature.toFixed(0)}°C`}
        />
        <InfoItem icon={Fan} color="#c084fc" value={rpm > 0 ? `${rpm.toLocaleString()}rpm` : '—'} />
        <InfoItem icon={Clock} color="#4ade80" value={formatUptime(uptime)} />
        <InfoItem icon={Network} color="#22d3ee" value={`${network.ping.toFixed(0)}ms`} />
        {topProcess && <InfoItem icon={Activity} color="#fb923c" value={shortProcessName(topProcess.name)} />}
      </div>
    </ServerShell>
  );
};

type ServerStatus = 'online' | 'offline' | 'connecting';

const STATUS_COLOR: Record<ServerStatus, string> = {
  online: '#34d399',
  offline: '#f87171',
  connecting: '#8b93a7'
};

// The shared shell of a node card — the same look (border/background/header) as the main dashboard's Card.
const ServerShell: React.FC<{
  name: string;
  host: string;
  status: ServerStatus;
  children: React.ReactNode;
}> = ({ name, host, status, children }) => (
  <section className="dash-card flex flex-col rounded-lg border border-gray-700 bg-gray-800">
    <div className="dash-card-head flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Server className="dash-icon shrink-0" color={STATUS_COLOR[status]} strokeWidth={2} />
        <h2 className="t-label truncate font-bold tracking-[0.04em] text-gray-100">{name}</h2>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            status === 'online' && 'animate-[pulseDot_2s_ease-in-out_infinite] bg-green-400',
            status === 'offline' && 'animate-[pulseDot_0.6s_ease-in-out_infinite] bg-red-400',
            status === 'connecting' && 'bg-gray-500'
          )}
        />
        <span className="t-micro font-mono text-gray-500">{host}</span>
      </span>
    </div>
    {children}
  </section>
);

// --- Pieces inside the card ------------------------------------------------

interface MiniGaugeProps {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  percentage: number;
  caption: string;
}

// A compact version of the main dashboard's GaugeRow gauge tile, to fit three side by side in a card.
const MiniGauge: React.FC<MiniGaugeProps> = ({ icon: Icon, iconColor, label, percentage, caption }) => {
  const color = statusColor(percentage);

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="flex items-center gap-1">
        <Icon className="dash-icon shrink-0" color={iconColor} strokeWidth={2} />
        <span className="t-micro truncate text-gray-300">{label}</span>
      </div>
      <Gauge percentage={percentage} color={color} className="my-1" />
      <div className="t-value font-bold" style={{ color }}>
        {percentage.toFixed(0)}%
      </div>
      <div className="t-micro w-full truncate text-center text-gray-400">{caption}</div>
    </div>
  );
};

const InfoItem: React.FC<{ icon: LucideIcon; color: string; value: string }> = ({
  icon: Icon,
  color,
  value
}) => (
  <span className="flex items-center gap-1">
    <Icon className="dash-icon shrink-0" color={color} strokeWidth={2} />
    <span className="truncate font-mono" style={{ color }}>
      {value}
    </span>
  </span>
);

// --- Formatting helpers ----------------------------------------------------

function formatUptime(uptime: ServerData['uptime']): string {
  const { days, hours, minutes } = uptime;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// `comm` is usually just the executable name, but some nodes mix in a
// path/args, so keep only the basename of the first token. A display-only tidy-up to keep the name from overflowing a narrow cell.
function shortProcessName(name: string): string {
  return name.split(' ')[0].split('/').pop() ?? name;
}
