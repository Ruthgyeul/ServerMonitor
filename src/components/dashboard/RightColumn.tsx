import React from 'react';
import { AlignLeft, Shield, TerminalSquare, TrendingUp, TriangleAlert } from 'lucide-react';

import { EmptyRow, Panel, PanelTitle } from '@/components/dashboard/primitives';
import { DashboardData } from '@/utils/dashboardData';
import { formatBytes, formatRelativeTime } from '@/utils/format';
import { ALERT_LEVEL_COLORS } from '@/utils/statusColors';

// 1024x600 캔버스에 세로로 다 들어가는 최대 개수. 늘리면 아래 카드가 잘린다.
const MAX_ALERTS = 5;
const MAX_PROCESSES = 5;
const MAX_SESSIONS = 4;
const MAX_PEERS = 4;

interface RightColumnProps {
  data: DashboardData;
  now: number | null;
}

export const RightColumn: React.FC<RightColumnProps> = ({ data, now }) => (
  <div className="mr-[2px] flex min-h-0 w-[282px] min-w-0 shrink-0 flex-col gap-1 overflow-hidden">
    <AlertsLog data={data} now={now} />
    <TopProcesses data={data} />
    <SshSessions data={data} now={now} />
    <TopTraffic data={data} />
    <FirewallCard data={data} />
  </div>
);

const AlertsLog: React.FC<RightColumnProps> = ({ data, now }) => (
  <Panel className="flex w-full shrink-0 flex-col gap-[3px] overflow-hidden p-[7px]">
    <PanelTitle icon={TriangleAlert} color="#f87171" label="ALERTS LOG" />
    {data.alerts.length === 0 && <EmptyRow>no alerts recorded</EmptyRow>}
    {data.alerts.slice(0, MAX_ALERTS).map(alert => (
      <div key={alert.id} className="flex justify-between gap-1.5 text-[9.5px]">
        <span className="truncate" style={{ color: ALERT_LEVEL_COLORS[alert.level] ?? '#9ca3af' }}>
          {alert.message}
        </span>
        <span className="shrink-0 text-gray-500">
          {now === null ? '' : formatRelativeTime(alert.at, now)}
        </span>
      </div>
    ))}
  </Panel>
);

const TopProcesses: React.FC<{ data: DashboardData }> = ({ data }) => {
  const processes = data.processes
    .filter(process => process.cpu > 0 || process.memory > 0)
    .slice(0, MAX_PROCESSES);

  return (
    <Panel className="flex w-full shrink-0 flex-col overflow-hidden p-[7px]">
      <PanelTitle icon={AlignLeft} color="#fb923c" label="TOP PROCESSES" className="mb-1 shrink-0" />
      <div className="mb-[2px] flex shrink-0 items-center justify-between text-[8.5px] text-gray-400">
        <span>Name</span>
        <div className="flex gap-[5px]">
          <span className="w-[26px] text-right text-yellow-400">CPU</span>
          <span className="w-[26px] text-right text-blue-400">RAM</span>
        </div>
      </div>
      {processes.length === 0 && <EmptyRow>process list unavailable</EmptyRow>}
      {processes.map(process => (
        <div key={process.id} className="flex items-center justify-between py-px text-[9.5px]">
          <span className="max-w-[62%] truncate text-gray-400" title={process.name}>
            {process.name}
          </span>
          <div className="flex items-center gap-[5px]">
            <span className="w-[26px] text-right text-yellow-400">{process.cpu.toFixed(1)}</span>
            <span className="w-[26px] text-right text-blue-400">{process.memory.toFixed(1)}</span>
          </div>
        </div>
      ))}
    </Panel>
  );
};

const SshSessions: React.FC<RightColumnProps> = ({ data, now }) => (
  <Panel className="flex w-full shrink-0 flex-col gap-1 overflow-hidden p-[7px]">
    <PanelTitle icon={TerminalSquare} color="#38bdf8" label="SSH SESSIONS" />
    {data.security.sshSessions.length === 0 && <EmptyRow>no remote sessions</EmptyRow>}
    {data.security.sshSessions.slice(0, MAX_SESSIONS).map(session => (
      <div key={`${session.user}@${session.ip}@${session.since}`} className="truncate text-[10px] text-gray-400">
        {session.user}@{session.ip}{' '}
        <span className="text-gray-500">· {now === null ? '' : formatRelativeTime(session.since, now)}</span>
      </div>
    ))}
  </Panel>
);

const TopTraffic: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Panel className="flex w-full shrink-0 flex-col gap-1 overflow-hidden p-[7px]">
    <PanelTitle icon={TrendingUp} color="#38bdf8" label="TOP TRAFFIC IPS" />
    {data.security.topTraffic.length === 0 && <EmptyRow>no external connections</EmptyRow>}
    {data.security.topTraffic.slice(0, MAX_PEERS).map(peer => (
      <div key={peer.ip} className="flex justify-between gap-2 text-[10px]">
        <span className="truncate text-gray-400">{peer.ip}</span>
        {/* conntrack 이 바이트를 세지 않는 커널에서는 연결 수만 알 수 있다. */}
        <span className="shrink-0 font-mono text-sky-400">
          {peer.bytes === null ? `${peer.connections} conn` : formatBytes(peer.bytes)}
        </span>
      </div>
    ))}
  </Panel>
);

const FirewallCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { firewall } = data.security;
  const color =
    firewall.status === 'active' ? '#4ade80' : firewall.status === 'inactive' ? '#f87171' : '#9ca3af';

  return (
    <Panel className="flex w-full shrink-0 flex-col gap-1 overflow-hidden p-[7px]">
      <PanelTitle
        icon={Shield}
        color={color}
        label="FIREWALL"
        right={
          <span className="shrink-0 whitespace-nowrap text-[9px]" style={{ color }}>
            {firewall.backend ? `${firewall.backend} · ${firewall.status}` : firewall.status}
          </span>
        }
      />
      <div className="text-[9.5px] text-gray-400">
        Blocked (24h):{' '}
        <span className="font-mono text-red-400">
          {firewall.blockedAttempts === null ? 'N/A' : firewall.blockedAttempts.toLocaleString()}
        </span>
      </div>
    </Panel>
  );
};
