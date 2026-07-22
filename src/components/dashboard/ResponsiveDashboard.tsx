import React from 'react';
import {
  Activity,
  AlignLeft,
  Clock,
  Cpu,
  Fan,
  HardDrive,
  HardDriveDownload,
  LucideIcon,
  MemoryStick,
  Monitor,
  Network,
  Server,
  Shield,
  TerminalSquare,
  Thermometer,
  TrendingUp,
  TriangleAlert
} from 'lucide-react';

import { NetworkAreaChart } from '@/components/charts/NetworkAreaChart';
import { currentAlerts } from '@/components/dashboard/AlertBanner';
import { Bar, Gauge, Sparkline } from '@/components/dashboard/primitives';
import { DiskIoPoint } from '@/hooks/useSystemData';
import { cn } from '@/lib/utils';
import { NetworkHistoryEntry } from '@/types/system';
import { DashboardData } from '@/utils/dashboardData';
import {
  formatBytes,
  formatClock,
  formatLinkSpeed,
  formatRate,
  formatRelativeTime,
  formatShortDateTime,
  shortKernel
} from '@/utils/format';
import { ALERT_LEVEL_COLORS, COLORS, loadCellColor, loadColor, statusColor, tempColor } from '@/utils/statusColors';

// 키오스크 배치가 읽히지 않는 화면(휴대폰, 세로 태블릿, 좁은 창)을 위한 레이아웃.
// 정보는 키오스크와 동일하고, 고정 캔버스 대신 세로로 흐르며 글자를 키운다.
const TEMP_SCALE_MAX = 90;
const TEMP_WARN = 65;
const TEMP_CRITICAL = 74;
const MAX_CORE_BARS = 16;
const MAX_ALERTS = 8;
const MAX_PROCESSES = 8;

interface ResponsiveDashboardProps {
  data: DashboardData;
  connected: boolean;
  lastUpdate: number | null;
  now: number | null;
  networkHistory: NetworkHistoryEntry[];
  diskIoHistory: DiskIoPoint[];
}

export const ResponsiveDashboard: React.FC<ResponsiveDashboardProps> = ({
  data,
  connected,
  lastUpdate,
  now,
  networkHistory,
  diskIoHistory
}) => (
  <div className="min-h-screen bg-gray-900 pb-6 text-gray-100">
    <Header data={data} connected={connected} lastUpdate={lastUpdate} now={now} />
    <AlertRow data={data} />

    <main className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      <GaugeRow data={data} />
      <StatRow data={data} />
      <NetworkCard data={data} history={networkHistory} />
      <CpuCoresCard data={data} />
      <CpuDayCard data={data} />
      <LoadHistoryCard data={data} />
      <SwapCard data={data} />
      <DiskIoCard data={data} history={diskIoHistory} />
      <InterfacesCard data={data} />
      <BandwidthCard data={data} />
      <AlertsCard data={data} now={now} />
      <ProcessesCard data={data} />
      <SshCard data={data} now={now} />
      <TrafficCard data={data} />
      <FirewallCard data={data} />
    </main>
  </div>
);

// --- 공통 조각 -------------------------------------------------------------

interface CardProps {
  icon: LucideIcon;
  color: string;
  title: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ icon: Icon, color, title, right, className, children }) => (
  <section className={cn('rounded-lg border border-gray-700 bg-gray-800 p-3', className)}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon size={14} color={color} strokeWidth={2} className="shrink-0" />
        <h2 className="truncate text-[11px] font-medium tracking-wide text-gray-300">{title}</h2>
      </div>
      {right}
    </div>
    {children}
  </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs text-gray-500">{children}</p>
);

// 카드 하나가 그리드 전체 폭을 차지해야 할 때.
const fullWidth = 'sm:col-span-2 xl:col-span-3';

// --- 헤더 / 경고 -----------------------------------------------------------

const Header: React.FC<Omit<ResponsiveDashboardProps, 'networkHistory' | 'diskIoHistory'>> = ({
  data,
  connected,
  lastUpdate,
  now
}) => {
  const secondsAgo = now !== null && lastUpdate !== null ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : 0;

  return (
    <header className="sticky top-0 z-10 border-b border-gray-700 bg-gray-800/95 backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
        <div className="flex min-w-0 items-center gap-2">
          <Server size={18} color="#60a5fa" strokeWidth={2} className="shrink-0" />
          <h1 className="truncate text-base font-bold">Server Monitor</h1>
          <div className="h-2 w-2 shrink-0 animate-[pulseDot_2s_ease-in-out_infinite] rounded-full bg-green-400" />
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-xs text-gray-300">{now === null ? ' ' : formatClock(new Date(now))}</div>
          <div className={cn('text-[10px]', connected ? 'text-gray-500' : 'text-red-400')}>
            {connected ? `Live · ${secondsAgo}s ago` : 'Reconnecting…'}
          </div>
        </div>
      </div>
      {/* 좁은 화면에서는 호스트 이름까지 보여줄 여유가 있다. */}
      <div className="truncate px-3 pb-2 font-mono text-[10px] text-gray-500">
        {data.host.hostname} · {data.host.os} · {shortKernel(data.host.kernel)}
      </div>
    </header>
  );
};

const AlertRow: React.FC<{ data: DashboardData }> = ({ data }) => {
  const alerts = currentAlerts(data);
  const hasAlert = alerts.length > 0;
  const color = hasAlert ? '#f87171' : '#4ade80';

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-gray-700 px-3 py-2',
        hasAlert && 'animate-[alertBlink_1.2s_ease-in-out_infinite]'
      )}
      style={{ background: hasAlert ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.08)' }}
    >
      <TriangleAlert size={14} color={color} strokeWidth={2} className="shrink-0" />
      <span className="text-xs" style={{ color }}>
        {hasAlert ? `Warning: ${alerts.join(' · ')}` : 'All systems normal'}
      </span>
    </div>
  );
};

// --- 게이지 / 요약 ---------------------------------------------------------

interface GaugeTileProps {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  percentage: number | null;
  caption: string;
}

const GaugeTile: React.FC<GaugeTileProps> = ({ icon: Icon, iconColor, label, percentage, caption }) => {
  const color = percentage === null ? COLORS.muted : statusColor(percentage);

  return (
    <div className="flex flex-col items-center rounded-lg border border-gray-700 bg-gray-800 p-3">
      <div className="mb-2 flex w-full items-center gap-1.5">
        <Icon size={14} color={iconColor} strokeWidth={2} />
        <span className="text-[11px] text-gray-300">{label}</span>
      </div>
      <Gauge percentage={percentage ?? 0} color={color} size={68} strokeWidth={6} />
      <div className="mt-2 text-lg font-bold" style={{ color }}>
        {percentage === null ? 'N/A' : `${percentage.toFixed(1)}%`}
      </div>
      <div className="text-[11px] text-gray-400">{caption}</div>
    </div>
  );
};

const GaugeRow: React.FC<{ data: DashboardData }> = ({ data }) => {
  const toGb = (mb: number) => (mb / 1024).toFixed(1);

  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', fullWidth)}>
      <GaugeTile icon={Cpu} iconColor="#60a5fa" label="CPU" percentage={data.cpu.usage} caption={`${data.cpu.cores} cores`} />
      <GaugeTile
        icon={Monitor}
        iconColor="#c084fc"
        label="GPU"
        percentage={data.gpu.usage === 'N/A' ? null : data.gpu.usage}
        caption={data.gpu.temperature === 'N/A' ? 'no sensor' : `${data.gpu.temperature.toFixed(1)}°C`}
      />
      <GaugeTile
        icon={MemoryStick}
        iconColor="#4ade80"
        label="RAM"
        percentage={data.memory.percentage}
        caption={`${toGb(data.memory.used)}/${toGb(data.memory.total)}GB`}
      />
      <GaugeTile
        icon={HardDrive}
        iconColor="#facc15"
        label="DISK"
        percentage={data.disk.percentage}
        caption={`${data.disk.used.toFixed(0)}/${data.disk.total.toFixed(0)}GB`}
      />
    </div>
  );
};

const StatRow: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { load, cpu, fan, host, uptime } = data;
  const rpm = [fan.cpu, fan.case1, fan.case2].find(value => value > 0) ?? 0;
  const temperature = cpu.temperature;
  const temperatureColor = tempColor(temperature);

  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', fullWidth)}>
      <Card icon={Clock} color="#4ade80" title="UPTIME">
        <div className="text-xl font-bold text-white">
          {uptime.days}d {uptime.hours}h
        </div>
        <div className="text-xs text-gray-400">{uptime.minutes}m</div>
        <div className="mt-2 border-t border-gray-700 pt-2 text-[10px] leading-relaxed text-gray-500">
          Last reboot: {formatShortDateTime(host.bootTime)}
          <br />
          reason: {host.rebootReason ?? 'unknown'}
        </div>
      </Card>

      <Card icon={Activity} color="#f472b6" title="LOAD AVG">
        <div className="text-xl font-bold" style={{ color: loadColor(load.avg1, cpu.cores) }}>
          {load.avg1.toFixed(2)}
        </div>
        <div className="text-xs text-gray-400">1 min</div>
        <div className="mt-2 border-t border-gray-700 pt-2 text-[10px] leading-relaxed text-gray-500">
          5m {load.avg5.toFixed(2)}
          <br />
          15m {load.avg15.toFixed(2)}
        </div>
      </Card>

      <Card icon={Thermometer} color="#fb923c" title="CPU TEMP">
        <div className="text-xl font-bold" style={{ color: temperatureColor }}>
          {temperature === 'N/A' ? 'N/A' : `${temperature.toFixed(1)}°C`}
        </div>
        <Bar
          percentage={temperature === 'N/A' ? 0 : Math.min(100, (temperature / TEMP_SCALE_MAX) * 100)}
          color={temperatureColor}
          className="mt-2 overflow-visible"
        >
          <div
            className="absolute top-[-2px] h-[9px] w-px bg-yellow-400"
            style={{ left: `${(TEMP_WARN / TEMP_SCALE_MAX) * 100}%` }}
          />
          <div
            className="absolute top-[-2px] h-[9px] w-px bg-red-400"
            style={{ left: `${(TEMP_CRITICAL / TEMP_SCALE_MAX) * 100}%` }}
          />
        </Bar>
        <div className="mt-2 text-[10px] text-gray-500">
          {temperature === 'N/A'
            ? 'no sensor'
            : temperature >= TEMP_CRITICAL
              ? `${(temperature - TEMP_CRITICAL).toFixed(1)}° over alert threshold`
              : `${(TEMP_CRITICAL - temperature).toFixed(1)}° to alert threshold`}
        </div>
      </Card>

      <Card icon={Fan} color="#c084fc" title="FAN">
        <div className="text-xl font-bold text-white">{rpm > 0 ? rpm.toLocaleString() : 'N/A'}</div>
        <div className="text-xs text-gray-400">RPM</div>
      </Card>
    </div>
  );
};

// --- 네트워크 --------------------------------------------------------------

const NetworkCard: React.FC<{ data: DashboardData; history: NetworkHistoryEntry[] }> = ({ data, history }) => (
  <Card
    icon={Network}
    color="#22d3ee"
    title="NETWORK ACTIVITY"
    className={cn('xl:col-span-2', 'sm:col-span-2')}
    right={
      <span className="shrink-0 whitespace-nowrap font-mono text-[11px]">
        <span className="text-blue-400">↓ {formatRate(data.network.download)}</span>{' '}
        <span className="text-emerald-400">↑ {formatRate(data.network.upload)}</span>
      </span>
    }
  >
    <div className="h-44 sm:h-56">
      <NetworkAreaChart data={history} />
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-gray-700 pt-2 sm:grid-cols-4">
      <MiniStat value={data.network.ping.toFixed(1)} unit="ms ping" color="text-yellow-400" />
      <MiniStat
        value={`${data.network.errorRates.rx}/${data.network.errorRates.tx}%`}
        unit="rx/tx err"
        color="text-red-400"
      />
      <MiniStat value={String(data.network.connections)} unit="connections" color="text-green-400" />
      <MiniStat value={String(data.network.listeningPorts)} unit="listening ports" color="text-sky-400" />
    </div>
  </Card>
);

const MiniStat: React.FC<{ value: string; unit: string; color: string }> = ({ value, unit, color }) => (
  <div className="min-w-0">
    <div className={cn('truncate font-mono text-sm', color)}>{value}</div>
    <div className="truncate text-[10px] text-gray-500">{unit}</div>
  </div>
);

const InterfacesCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Card icon={Network} color="#22d3ee" title="INTERFACES">
    {data.network.interfaces.length === 0 && <Empty>no interfaces detected</Empty>}
    <ul className="space-y-1.5">
      {data.network.interfaces.map(entry => (
        <li key={entry.name} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-gray-300">
            {entry.name} <span className="text-gray-500">{entry.ip ?? '—'}</span>
          </span>
          <span className={cn('shrink-0 font-mono', entry.state === 'up' ? 'text-green-400' : 'text-gray-500')}>
            {entry.state !== 'up'
              ? entry.state
              : entry.speedMbps === null
                ? 'up'
                : entry.speedMbps >= 1000
                  ? `${entry.speedMbps / 1000}Gbps`
                  : `${entry.speedMbps}Mbps`}
          </span>
        </li>
      ))}
    </ul>
  </Card>
);

const BandwidthCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const percentage = data.network.bandwidthPercentage;
  const color = statusColor(percentage);

  return (
    <Card
      icon={TrendingUp}
      color="#a78bfa"
      title="BANDWIDTH"
      right={
        <span className="shrink-0 text-xs font-medium" style={{ color }}>
          {data.network.linkSpeedMbps === null ? '—' : `${percentage.toFixed(1)}%`}
        </span>
      }
    >
      <Bar percentage={percentage} color={color} className="h-2" />
      <p className="mt-2 text-[10px] text-gray-500">of {formatLinkSpeed(data.network.linkSpeedMbps)}</p>
    </Card>
  );
};

// --- CPU / 부하 ------------------------------------------------------------

const CpuCoresCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const cores = data.cpu.perCore.slice(0, MAX_CORE_BARS);
  const hidden = data.cpu.perCore.length - cores.length;

  return (
    <Card
      icon={Cpu}
      color="#60a5fa"
      title="CPU CORES"
      right={hidden > 0 ? <span className="text-[10px] text-gray-500">+{hidden} more</span> : undefined}
    >
      {cores.length === 0 && <Empty>per-core data unavailable</Empty>}
      {/* 세로 막대는 좁은 화면에서 뭉개진다. 가로 막대로 눕히면 코어가 많아도 읽힌다. */}
      <ul className="space-y-1.5">
        {cores.map((usage, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-[10px] text-gray-500">C{index}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-gray-900">
              <div className="h-full rounded" style={{ width: `${usage}%`, background: statusColor(usage) }} />
            </div>
            <span className="w-10 shrink-0 text-right text-[11px] text-gray-400">{usage.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

const CpuDayCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Card icon={Activity} color="#fb923c" title="CPU LOAD — LAST 24H">
    {data.history.cpuHourly.length === 0 ? (
      <Empty>collecting hourly averages…</Empty>
    ) : (
      <>
        <div className="flex gap-[2px]">
          {data.history.cpuHourly.map(sample => (
            <div
              key={sample.at}
              className="h-7 flex-1 rounded-sm"
              style={{ background: sample.usage === null ? COLORS.empty : statusColor(sample.usage) }}
              title={
                sample.usage === null
                  ? `${new Date(sample.at).getHours()}:00 — no data`
                  : `${new Date(sample.at).getHours()}:00 — ${sample.usage.toFixed(0)}%`
              }
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-500">
          <span>{new Date(data.history.cpuHourly[0].at).getHours()}:00</span>
          <span>now</span>
        </div>
      </>
    )}
  </Card>
);

const LoadHistoryCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const cells = [...Array(Math.max(0, 48 - data.history.load.length)).fill(null), ...data.history.load.slice(-48)];

  return (
    <Card
      icon={Activity}
      color="#f472b6"
      title="LOAD — LAST 12H"
      right={<span className="text-[10px] text-gray-500">15 min per cell</span>}
    >
      <div className="grid grid-cols-12 gap-1">
        {cells.map((cell, index) => (
          <div
            key={cell ? cell.at : `empty-${index}`}
            className="aspect-square rounded-sm"
            style={{ background: loadCellColor(cell?.avg1 ?? null, data.cpu.cores) }}
            title={
              cell?.avg1 != null ? `${formatShortDateTime(cell.at)} · load ${cell.avg1.toFixed(2)}` : 'no data'
            }
          />
        ))}
      </div>
    </Card>
  );
};

// --- 메모리 / 디스크 -------------------------------------------------------

const SwapCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { swap } = data;
  const color = statusColor(swap.percentage);

  return (
    <Card
      icon={MemoryStick}
      color="#38bdf8"
      title="SWAP"
      right={
        <span className="shrink-0 text-xs font-medium" style={{ color }}>
          {swap.total > 0 ? `${swap.percentage.toFixed(0)}%` : 'off'}
        </span>
      }
    >
      <Bar percentage={swap.percentage} color={color} className="h-2" />
      <p className="mt-2 text-xs text-gray-400">
        {swap.total > 0 ? `${swap.used.toFixed(2)} / ${swap.total.toFixed(1)} GB` : 'no swap configured'}
      </p>
    </Card>
  );
};

const DiskIoCard: React.FC<{ data: DashboardData; history: DiskIoPoint[] }> = ({ data, history }) => (
  <Card
    icon={HardDriveDownload}
    color="#38bdf8"
    title="DISK I/O"
    right={
      <span className="shrink-0 whitespace-nowrap font-mono text-[11px]">
        <span className="text-blue-400">R {data.diskIO.read.toFixed(1)}</span>{' '}
        <span className="text-pink-400">W {data.diskIO.write.toFixed(1)}</span>{' '}
        <span className="text-gray-500">MB/s</span>
      </span>
    }
  >
    <div className="h-16">
      <Sparkline
        series={[
          { key: 'read', values: history.map(point => point.read), color: '#60a5fa' },
          { key: 'write', values: history.map(point => point.write), color: '#f472b6' }
        ]}
      />
    </div>
  </Card>
);

// --- 로그 / 보안 -----------------------------------------------------------

const AlertsCard: React.FC<{ data: DashboardData; now: number | null }> = ({ data, now }) => (
  <Card icon={TriangleAlert} color="#f87171" title="ALERTS LOG">
    {data.alerts.length === 0 && <Empty>no alerts recorded</Empty>}
    <ul className="space-y-1.5">
      {data.alerts.slice(0, MAX_ALERTS).map(alert => (
        <li key={alert.id} className="flex items-start justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-start gap-1.5">
            <span
              className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: ALERT_LEVEL_COLORS[alert.level] ?? '#9ca3af' }}
            />
            <span style={{ color: ALERT_LEVEL_COLORS[alert.level] ?? '#9ca3af' }}>{alert.message}</span>
          </span>
          <span className="shrink-0 text-gray-500">{now === null ? '' : formatRelativeTime(alert.at, now)}</span>
        </li>
      ))}
    </ul>
  </Card>
);

const ProcessesCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const processes = data.processes.filter(p => p.cpu > 0 || p.memory > 0).slice(0, MAX_PROCESSES);

  return (
    <Card icon={AlignLeft} color="#fb923c" title="TOP PROCESSES">
      <div className="mb-1 flex items-center justify-between text-[10px] text-gray-500">
        <span>Name</span>
        <div className="flex gap-3">
          <span className="w-10 text-right text-yellow-400">CPU %</span>
          <span className="w-10 text-right text-blue-400">RAM %</span>
        </div>
      </div>
      {processes.length === 0 && <Empty>process list unavailable</Empty>}
      <ul>
        {processes.map(process => (
          <li key={process.id} className="flex items-center justify-between gap-2 py-1 text-xs">
            <span className="min-w-0 truncate text-gray-300" title={process.name}>
              {process.name}
            </span>
            <div className="flex shrink-0 gap-3 font-mono">
              <span className="w-10 text-right text-yellow-400">{process.cpu.toFixed(1)}</span>
              <span className="w-10 text-right text-blue-400">{process.memory.toFixed(1)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};

const SshCard: React.FC<{ data: DashboardData; now: number | null }> = ({ data, now }) => (
  <Card icon={TerminalSquare} color="#38bdf8" title="SSH SESSIONS">
    {data.security.sshSessions.length === 0 && <Empty>no remote sessions</Empty>}
    <ul className="space-y-1.5">
      {data.security.sshSessions.map(session => (
        <li
          key={`${session.user}@${session.ip}@${session.since}`}
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span className="min-w-0 truncate text-gray-300">
            {session.user}@{session.ip}
          </span>
          <span className="shrink-0 text-gray-500">{now === null ? '' : formatRelativeTime(session.since, now)}</span>
        </li>
      ))}
    </ul>
  </Card>
);

const TrafficCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Card icon={TrendingUp} color="#38bdf8" title="TOP TRAFFIC IPS">
    {data.security.topTraffic.length === 0 && <Empty>no external connections</Empty>}
    <ul className="space-y-1.5">
      {data.security.topTraffic.map(peer => (
        <li key={peer.ip} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate font-mono text-gray-300">{peer.ip}</span>
          <span className="shrink-0 font-mono text-sky-400">
            {peer.bytes === null ? `${peer.connections} conn` : formatBytes(peer.bytes)}
          </span>
        </li>
      ))}
    </ul>
  </Card>
);

const FirewallCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { firewall } = data.security;
  const color = firewall.status === 'active' ? '#4ade80' : firewall.status === 'inactive' ? '#f87171' : '#9ca3af';

  return (
    <Card
      icon={Shield}
      color={color}
      title="FIREWALL"
      right={
        <span className="shrink-0 text-xs font-medium" style={{ color }}>
          {firewall.backend ? `${firewall.backend} · ${firewall.status}` : firewall.status}
        </span>
      }
    >
      <p className="text-xs text-gray-400">
        Blocked (24h):{' '}
        <span className="font-mono text-red-400">
          {firewall.blockedAttempts === null ? 'N/A' : firewall.blockedAttempts.toLocaleString()}
        </span>
      </p>
    </Card>
  );
};
