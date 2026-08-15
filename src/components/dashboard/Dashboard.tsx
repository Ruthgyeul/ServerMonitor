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
import { Bar, Gauge, Sparkline } from '@/components/dashboard/primitives';
import { DiskIoPoint } from '@/hooks/useSystemData';
import { cn } from '@/lib/utils';
import { NetworkHistoryEntry } from '@/types/system';
import { DashboardData } from '@/utils/dashboardData';
import {
  formatBytes,
  formatClock,
  formatLinkSpeed,
  formatMbPair,
  formatRate,
  formatRelativeTime,
  formatShortDateTime,
  shortKernel
} from '@/utils/format';
import {
  ALERT_LEVEL_COLORS,
  COLORS,
  heatColor,
  loadCellColor,
  loadColor,
  statusColor,
  tempColor
} from '@/utils/statusColors';

// Cards flow in a multi-column layout (.dash-grid), becoming 1/2/3 columns with
// screen width. The column count and dimensions are all set by src/styles/globals.css.
const TEMP_SCALE_MAX = 90;
const TEMP_WARN = 65;
const TEMP_CRITICAL = 74;
const MAX_CORE_BARS = 16;
const MAX_ALERTS = 5;
const MAX_PROCESSES = 6;
const MAX_SESSIONS = 4;
const MAX_PEERS = 4;
// Drawing docker/bridge/veth too would let one card eat an entire column.
const MAX_INTERFACES = 4;
// Above this, the core bars fold onto two rows.
const CORE_SPLIT_THRESHOLD = 8;
const LOAD_CELLS = 48;
// The 30-minute moving-average window length. Same value as ROLLING_WINDOW_MS in
// history.ts; used here only to decide "is the window full".
const ROLLING_30M_SECONDS = 30 * 60;

interface DashboardProps {
  data: DashboardData;
  connected: boolean;
  lastUpdate: number | null;
  now: number | null;
  networkHistory: NetworkHistoryEntry[];
  diskIoHistory: DiskIoPoint[];
}

export const Dashboard: React.FC<DashboardProps> = ({
  data,
  connected,
  lastUpdate,
  now,
  networkHistory,
  diskIoHistory
}) => (
  <div className="terminal-bg min-h-screen text-gray-100">
    <TerminalTitleBar data={data} />
    <Header data={data} connected={connected} lastUpdate={lastUpdate} now={now} />
    <AlertBar data={data} />

    {/* The column makeup and the order within each column follow the design.
        As the screen narrows, columns fold below whole; cards are never rearranged. */}
    <div className="dash-layout">
      <div className="dash-col">
        <UptimeCard data={data} />
        <LoadCard data={data} />
        <CoresCard data={data} />
        <SwapCard data={data} />
        <DiskIoCard data={data} history={diskIoHistory} />
        <div className="dash-subgrid">
          <FanCard data={data} />
          <TemperatureCard data={data} />
        </div>
      </div>

      <div className="dash-col">
        <GaugeRow data={data} />
        <CpuDayCard data={data} />
        <NetworkCard data={data} history={networkHistory} />
        <div className="dash-subgrid">
          <InterfacesCard data={data} />
          <BandwidthCard data={data} />
        </div>
        <NetworkStripCard data={data} />
      </div>

      <div className="dash-col">
        <AlertsCard data={data} now={now} />
        <ProcessesCard data={data} />
        <SshCard data={data} now={now} />
        <TrafficCard data={data} />
        <FirewallCard data={data} />
      </div>
    </div>
  </div>
);

// --- Shared pieces ---------------------------------------------------------

interface CardProps {
  icon: LucideIcon;
  color: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ icon: Icon, color, title, right, children }) => (
  <section className="dash-card rounded-lg border border-gray-700 bg-gray-800">
    <div className="dash-card-head flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className="dash-icon shrink-0" color={color} strokeWidth={2} />
        <h2 className="t-label truncate uppercase tracking-[0.08em] text-gray-300">{title}</h2>
      </div>
      {right}
    </div>
    {children}
  </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="t-body text-gray-500">{children}</p>
);

// --- Header / alerts -------------------------------------------------------

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

  return alerts;
}

// Terminal-window chrome. Just the traffic lights + path wrap the dashboard like
// a "terminal window". A purely decorative top bar that touches no layout or data.
const TerminalTitleBar: React.FC<{ data: DashboardData }> = ({ data }) => {
  const host = data.host.hostname || 'server';

  return (
    <div className="term-titlebar">
      <div className="flex shrink-0 items-center gap-[7px]">
        <span className="term-dot" style={{ background: '#ff5f56' }} />
        <span className="term-dot" style={{ background: '#ffbd2e' }} />
        <span className="term-dot" style={{ background: '#27c93f' }} />
      </div>
      <span className="min-w-0 flex-1 truncate text-center font-mono">
        <span style={{ color: '#34d399' }}>root@{host}</span>
        <span style={{ color: '#5c6478' }}> — ~/monitor — </span>
        <span style={{ color: '#8b93a7' }}>zsh</span>
      </span>
      <span className="shrink-0 font-mono text-gray-500">⎇ main</span>
    </div>
  );
};

type HeaderProps = Omit<DashboardProps, 'networkHistory' | 'diskIoHistory'>;

const Header: React.FC<HeaderProps> = ({ data, connected, lastUpdate, now }) => {
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
        <div className="h-[7px] w-[7px] shrink-0 animate-[pulseDot_2s_ease-in-out_infinite] rounded-full bg-green-400" />
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
                ? 'animate-[pulseDot_2s_ease-in-out_infinite] bg-green-400'
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

const AlertBar: React.FC<{ data: DashboardData }> = ({ data }) => {
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

// --- Gauges ----------------------------------------------------------------

interface GaugeTileProps {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  percentage: number | null;
  caption: string;
  // The line shown on hover or tap of the gauge. caption is truncated to fit the
  // cell, but this holds the full, un-truncated numbers.
  detail: string;
}

// In the design the four gauges are each their own card.
const GaugeCard: React.FC<GaugeTileProps> = ({
  icon: Icon,
  iconColor,
  label,
  percentage,
  caption,
  detail
}) => {
  const color = percentage === null ? COLORS.muted : statusColor(percentage);

  return (
    <section className="gauge-card dash-card flex min-w-0 flex-col items-center rounded-lg border border-gray-700 bg-gray-800">
      <div className="flex w-full items-center gap-1">
        <Icon className="dash-icon shrink-0" color={iconColor} strokeWidth={2} />
        <span className="t-micro truncate text-gray-300">{label}</span>
      </div>
      {/* The gauge+value group owns the tooltip. It must appear only over the
          graphic, not the whole card, so it doesn't flicker when moving to a neighbor. */}
      <div className="dash-tip flex flex-col items-center" tabIndex={-1} data-tip={detail}>
        <Gauge
          percentage={percentage ?? 0}
          color={color}
          className="my-1"
          ariaLabel={percentage === null ? `${label} unavailable` : `${label} ${percentage.toFixed(0)}%`}
        />
        <div className="t-value font-bold" style={{ color }}>
          {percentage === null ? 'N/A' : `${percentage.toFixed(1)}%`}
        </div>
      </div>
      <div className="t-micro w-full truncate text-center text-gray-400">{caption}</div>
    </section>
  );
};

const GaugeRow: React.FC<{ data: DashboardData }> = ({ data }) => {
  const toGb = (mb: number) => (mb / 1024).toFixed(1);

  // Append the new metrics to the CPU tooltip (layout unchanged, only shown on
  // hover): current clock, I/O wait, and steal when it's above 0 (an oversubscribed VPS).
  const cpuFreq = data.cpu.frequencyMhz === 'N/A' ? '' : ` · ${(data.cpu.frequencyMhz / 1000).toFixed(2)}GHz`;
  const cpuSteal = data.cpu.steal > 0 ? ` · steal ${data.cpu.steal.toFixed(1)}%` : '';
  const cpuDetail = `${data.cpu.usage.toFixed(1)}% across ${data.cpu.cores} cores · load 1m ${data.load.avg1.toFixed(
    2
  )}${cpuFreq} · iowait ${data.cpu.iowait.toFixed(1)}%${cpuSteal}`;

  // Append non-root mount usage to the DISK tooltip, plus the fill forecast when it's filling.
  const extraMounts = data.disks.filter(mount => mount.mount !== '/');
  const mountDetail =
    extraMounts.length > 0
      ? ' · ' + extraMounts.map(mount => `${mount.mount} ${mount.percentage.toFixed(0)}%`).join(' · ')
      : '';
  const fillDetail =
    data.disk.hoursToFull !== null && data.disk.hoursToFull !== undefined
      ? ` · full in ~${data.disk.hoursToFull < 48 ? `${data.disk.hoursToFull.toFixed(1)}h` : `${Math.round(data.disk.hoursToFull / 24)}d`}`
      : '';

  // The design places four on one row. At phone width the cell gets narrower than
  // the gauge diameter and overflows, so it folds to 2x2 only then.
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <GaugeCard
        icon={Cpu}
        iconColor="#60a5fa"
        label="CPU"
        percentage={data.cpu.usage}
        caption={`${data.cpu.cores} cores`}
        detail={cpuDetail}
      />
      <GaugeCard
        icon={Monitor}
        iconColor="#c084fc"
        label="GPU"
        percentage={data.gpu.usage === 'N/A' ? null : data.gpu.usage}
        caption={data.gpu.temperature === 'N/A' ? 'no sensor' : `${data.gpu.temperature.toFixed(1)}°C`}
        detail={
          data.gpu.usage === 'N/A'
            ? 'no GPU sensor detected on this host'
            : `${data.gpu.usage.toFixed(1)}% used${
                data.gpu.temperature === 'N/A' ? '' : ` · ${data.gpu.temperature.toFixed(1)}°C`
              }`
        }
      />
      <GaugeCard
        icon={MemoryStick}
        iconColor="#4ade80"
        label="RAM"
        percentage={data.memory.percentage}
        caption={`${toGb(data.memory.used)}/${toGb(data.memory.total)}G`}
        detail={`${toGb(data.memory.used)}G used of ${toGb(data.memory.total)}G · ${toGb(
          Math.max(0, data.memory.total - data.memory.used)
        )}G free`}
      />
      <GaugeCard
        icon={HardDrive}
        iconColor="#facc15"
        label="DISK"
        percentage={data.disk.percentage}
        caption={`${data.disk.used.toFixed(0)}/${data.disk.total.toFixed(0)}G`}
        detail={`${data.disk.used.toFixed(1)}G used of ${data.disk.total.toFixed(1)}G · ${Math.max(
          0,
          data.disk.total - data.disk.used
        ).toFixed(1)}G free${mountDetail}${fillDetail}`}
      />
    </div>
  );
};

// --- System ----------------------------------------------------------------

const UptimeCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Card icon={Clock} color="#4ade80" title="UPTIME">
    <div className="t-hero font-bold text-white">
      {data.uptime.days}d {data.uptime.hours}h
    </div>
    <div className="t-micro text-gray-400">{data.uptime.minutes}m</div>
    <div className="t-micro mt-1 border-t border-gray-700 pt-1 leading-[1.35] text-gray-500">
      Last reboot: {formatShortDateTime(data.host.bootTime)}
      <br />
      reason: {data.host.rebootReason ?? 'unknown'}
      {data.battery && (
        <>
          <br />
          battery: {data.battery.percentage}% ({data.battery.status})
        </>
      )}
    </div>
  </Card>
);

const LoadCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { load, cpu, history } = data;

  // One cell is 1 hour, so 48 cells is 48 hours. If not yet full, pad the front
  // with empty cells to keep the grid shape.
  const cells = [
    ...Array(Math.max(0, LOAD_CELLS - history.load.length)).fill(null),
    ...history.load.slice(-LOAD_CELLS)
  ];

  // The instantaneous value is the run-queue task count. On an OS without /proc
  // it can't be read, so it falls back to the 1-minute average — the value used to pick the color follows too.
  const liveLoad = load.running ?? load.avg1;

  // Core-normalized load (1.00 = all cores saturated). A load of 8 means
  // different things on 4 vs 16 cores, so show this alongside the absolute value.
  const perCoreLoad = load.avg1 / Math.max(1, cpu.cores);
  const perCoreTip = `1-minute load per core (1.00 = all ${cpu.cores} cores fully saturated)`;

  // The kernel doesn't give 30m, so we compute it from our samples. If the window
  // isn't full yet, mark it with an asterisk and note the actually-covered span in
  // the tooltip — taken in seconds so it isn't a "0-minute average" right after start.
  const partial30m = load.avg30 !== null && load.avg30WindowSeconds < ROLLING_30M_SECONDS;
  const window30m =
    load.avg30WindowSeconds < 60
      ? `${load.avg30WindowSeconds}s`
      : `${Math.floor(load.avg30WindowSeconds / 60)}min`;
  const avg30Tip =
    load.avg30 === null
      ? 'collecting — no samples since start yet'
      : partial30m
        ? `average over the last ${window30m} so far, filling to 30min`
        : 'average over the last 30min';

  return (
    <Card
      icon={Activity}
      color="#f472b6"
      title="LOAD AVG"
      right={
        <span
          className="dash-tip t-micro shrink-0 whitespace-nowrap"
          tabIndex={-1}
          style={{ color: loadColor(liveLoad, cpu.cores) }}
          data-tip={
            load.running === null
              ? 'live run queue unavailable on this OS — showing 1m average'
              : `${load.running} task${load.running === 1 ? '' : 's'} running or waiting right now`
          }
        >
          {load.running === null ? `now ${load.avg1.toFixed(2)}` : `now ${load.running}`}
        </span>
      }
    >
      <div className="t-micro mb-1 flex items-center justify-between gap-2 text-gray-500">
        <span
          className="dash-tip"
          tabIndex={-1}
          data-tip={perCoreTip}
          style={{ color: loadColor(load.avg1, cpu.cores) }}
        >
          {perCoreLoad.toFixed(2)}
          <span className="text-gray-600">/core</span>
        </span>
        <span className="truncate">
          1m {load.avg1.toFixed(2)} · 15m {load.avg15.toFixed(2)} ·{' '}
          <span className="dash-tip" tabIndex={-1} data-tip={avg30Tip}>
            30m {load.avg30 === null ? '—' : load.avg30.toFixed(2)}
            {partial30m ? '*' : ''}
          </span>
        </span>
      </div>
      <div
        className="dash-loadgrid grid grid-cols-12"
        role="list"
        aria-label="Load average, one cell per hour over the last 48 hours"
      >
        {cells.map((cell, index) => {
          const label =
            cell?.avg1 != null ? `${formatShortDateTime(cell.at)} · load ${cell.avg1.toFixed(2)}` : 'no data';
          return (
            <div
              key={cell ? cell.at : `empty-${index}`}
              role="listitem"
              // Keep it out of tab order (there are 48 cells) but let it take focus on tap.
              // This is the only path for the tooltip to appear on touch.
              tabIndex={-1}
              className="dash-loadcell dash-tip rounded-[2px]"
              style={{ background: loadCellColor(cell?.avg1 ?? null, cpu.cores) }}
              data-tip={label}
              aria-label={label}
            />
          );
        })}
      </div>
    </Card>
  );
};

const CoresCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const cores = data.cpu.perCore.slice(0, MAX_CORE_BARS);
  const hidden = data.cpu.perCore.length - cores.length;

  return (
    <Card
      icon={Cpu}
      color="#60a5fa"
      title="CPU CORES"
      right={hidden > 0 ? <span className="t-micro shrink-0 text-gray-500">+{hidden}</span> : undefined}
    >
      {cores.length === 0 && <Empty>per-core data unavailable</Empty>}
      {/* Horizontal bars stay readable no matter how many cores or how narrow the column. */}
      <ul className={cn('dash-corelist', cores.length > CORE_SPLIT_THRESHOLD && 'dash-corelist--split')}>
        {cores.map((usage, index) => (
          <li
            key={index}
            className="dash-tip flex items-center gap-1.5"
            tabIndex={-1}
            // The number beside the bar is rounded to an integer to save space. The decimal is given here.
            data-tip={`core ${index} · ${usage.toFixed(1)}%`}
          >
            {/* Width in ch so it widens with the type scale (--dash-scale). Fixing
                it in px would make the numbers overflow the cell and collide on large screens. */}
            <span className="t-micro w-[3ch] shrink-0 text-gray-500">C{index}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-gray-900">
              <div
                className="h-full rounded"
                style={{ width: `${usage}%`, background: statusColor(usage) }}
              />
            </div>
            <span className="t-micro w-[4ch] shrink-0 text-right text-gray-400">{usage.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

const TemperatureCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const temperature = data.cpu.temperature;
  const color = tempColor(temperature);

  return (
    <Card icon={Thermometer} color="#fb923c" title="CPU TEMP">
      <div className="t-value font-bold" style={{ color }}>
        {temperature === 'N/A' ? 'N/A' : `${temperature.toFixed(1)}°C`}
      </div>
      <Bar
        percentage={temperature === 'N/A' ? 0 : Math.min(100, (temperature / TEMP_SCALE_MAX) * 100)}
        color={color}
        className="my-1 overflow-visible"
      >
        <div
          className="absolute top-[-1px] h-[7px] w-px bg-yellow-400"
          style={{ left: `${(TEMP_WARN / TEMP_SCALE_MAX) * 100}%` }}
        />
        <div
          className="absolute top-[-1px] h-[7px] w-px bg-red-400"
          style={{ left: `${(TEMP_CRITICAL / TEMP_SCALE_MAX) * 100}%` }}
        />
      </Bar>
      <div className="t-micro text-gray-500">
        {temperature === 'N/A'
          ? 'no sensor'
          : temperature >= TEMP_CRITICAL
            ? `${(temperature - TEMP_CRITICAL).toFixed(1)}° over alert threshold`
            : `${(TEMP_CRITICAL - temperature).toFixed(1)}° to alert threshold`}
      </div>
    </Card>
  );
};

const FanCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  // Which connector the fan is plugged into varies by motherboard, so use the first one that has a value.
  const rpm = [data.fan.cpu, data.fan.case1, data.fan.case2].find(value => value > 0) ?? 0;

  return (
    <Card icon={Fan} color="#c084fc" title="FAN">
      <div className="t-hero font-bold text-white">{rpm > 0 ? rpm.toLocaleString() : 'N/A'}</div>
      <div className="t-micro text-gray-400">RPM</div>
    </Card>
  );
};

const CpuDayCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Card icon={Activity} color="#fb923c" title="CPU LOAD — LAST 24H">
    {data.history.cpuHourly.length === 0 ? (
      <Empty>collecting hourly averages…</Empty>
    ) : (
      <>
        <div
          className="dash-heatrow flex gap-[2px]"
          role="list"
          aria-label="CPU usage, one cell per hour over the last 24 hours"
        >
          {data.history.cpuHourly.map(sample => {
            const hour = `${new Date(sample.at).getHours()}:00`;
            const label =
              sample.usage === null ? `${hour} — no data` : `${hour} — ${sample.usage.toFixed(0)}%`;
            return (
              <div
                key={sample.at}
                role="listitem"
                tabIndex={-1}
                className="dash-heat dash-tip flex-1 rounded-[2px]"
                style={{ background: sample.usage === null ? COLORS.empty : heatColor(sample.usage / 100) }}
                data-tip={label}
                aria-label={label}
              />
            );
          })}
        </div>
        <div className="t-micro mt-1 flex justify-between text-gray-500">
          <span>{new Date(data.history.cpuHourly[0].at).getHours()}:00</span>
          <span>now</span>
        </div>
      </>
    )}
  </Card>
);

const SwapCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { swap } = data;
  const color = statusColor(swap.percentage);

  return (
    <Card
      icon={MemoryStick}
      color="#38bdf8"
      title="SWAP"
      right={
        <span className="t-label shrink-0" style={{ color }}>
          {swap.total > 0 ? `${swap.percentage.toFixed(0)}%` : 'off'}
        </span>
      }
    >
      <div
        className="dash-tip"
        tabIndex={-1}
        data-tip={
          swap.total > 0
            ? `${swap.used.toFixed(2)}GB used of ${swap.total.toFixed(1)}GB · ${Math.max(
                0,
                swap.total - swap.used
              ).toFixed(2)}GB free`
            : 'no swap configured on this host'
        }
      >
        <Bar percentage={swap.percentage} color={color} />
      </div>
      <p className="t-micro mt-1 text-gray-400">
        {swap.total > 0 ? `${swap.used.toFixed(2)}/${swap.total.toFixed(1)}GB` : 'no swap configured'}
      </p>
    </Card>
  );
};

const DiskIoCard: React.FC<{ data: DashboardData; history: DiskIoPoint[] }> = ({ data, history }) => {
  const io = formatMbPair(data.diskIO.read, data.diskIO.write);

  return (
    <Card
      icon={HardDriveDownload}
      color="#38bdf8"
      title="DISK I/O"
      right={
        <span className="t-micro shrink-0 whitespace-nowrap font-mono">
          <span className="text-blue-400">R {io.read}</span>{' '}
          <span className="text-pink-400">W {io.write}</span> <span className="text-gray-500">{io.unit}</span>
        </span>
      }
    >
      <div className="dash-spark">
        <Sparkline
          series={[
            { key: 'read', values: history.map(point => point.read), color: '#60a5fa' },
            { key: 'write', values: history.map(point => point.write), color: '#f472b6' }
          ]}
        />
      </div>
    </Card>
  );
};

// --- Network ---------------------------------------------------------------

const NetworkCard: React.FC<{ data: DashboardData; history: NetworkHistoryEntry[] }> = ({
  data,
  history
}) => (
  <Card
    icon={Network}
    color="#22d3ee"
    title="NETWORK ACTIVITY"
    right={
      <span className="t-micro shrink-0 whitespace-nowrap font-mono">
        <span className="text-blue-400">↓ {formatRate(data.network.download)}</span>{' '}
        <span className="text-emerald-400">↑ {formatRate(data.network.upload)}</span>
      </span>
    }
  >
    {/* Show the since-boot cumulative totals in the legend so bandwidth usage —
        which the instantaneous rate alone can't tell you — is visible at a glance. */}
    <div className="t-micro flex items-center justify-center gap-4 text-gray-400">
      <span className="flex items-center gap-1">
        <span className="h-[7px] w-[7px] rounded-full bg-blue-500" />
        Download · {formatBytes(data.network.totalRxBytes)}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-[7px] w-[7px] rounded-full bg-emerald-500" />
        Upload · {formatBytes(data.network.totalTxBytes)}
      </span>
    </div>
    <div className="dash-chart">
      <NetworkAreaChart data={history} />
    </div>
  </Card>
);

// A one-line summary bar placed separately below the chart in the design.
const NetworkStripCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <section className="dash-card flex flex-wrap items-center justify-around gap-x-4 gap-y-1 rounded-lg border border-gray-700 bg-gray-800">
    <StripItem value={data.network.ping.toFixed(1)} unit="ms ping" color="text-yellow-400" />
    <StripItem
      value={`${data.network.errorRates.rx}/${data.network.errorRates.tx}%`}
      unit="err"
      color="text-red-400"
    />
    <StripItem value={String(data.network.connections)} unit="conns" color="text-green-400" />
    <StripItem value={String(data.network.listeningPorts)} unit="ports" color="text-sky-400" />
  </section>
);

const StripItem: React.FC<{ value: string; unit: string; color: string }> = ({ value, unit, color }) => (
  <div className="t-body whitespace-nowrap">
    <span className={cn('font-mono', color)}>{value}</span>
    <span className="text-gray-500"> {unit}</span>
  </div>
);

const InterfacesCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const hidden = Math.max(0, data.network.interfaces.length - MAX_INTERFACES);

  return (
    <Card
      icon={Network}
      color="#22d3ee"
      title="INTERFACES"
      right={hidden > 0 ? <span className="t-micro shrink-0 text-gray-500">+{hidden}</span> : undefined}
    >
      {data.network.interfaces.length === 0 && <Empty>no interfaces detected</Empty>}
      <ul className="dash-rows">
        {data.network.interfaces.slice(0, MAX_INTERFACES).map(entry => (
          <li key={entry.name} className="t-body flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-gray-400">
              {entry.name} <span className="text-gray-500">{entry.ip ?? '—'}</span>
            </span>
            <span
              className={cn('shrink-0 font-mono', entry.state === 'up' ? 'text-green-400' : 'text-gray-500')}
            >
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
};

const BandwidthCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const percentage = data.network.bandwidthPercentage;
  const color = statusColor(percentage);
  // The same value the gauge measures: current total throughput (download + upload).
  const usage = data.network.download + data.network.upload;

  return (
    <Card
      icon={TrendingUp}
      color="#a78bfa"
      title="BANDWIDTH"
      right={
        <span className="t-label shrink-0" style={{ color }}>
          {data.network.linkSpeedMbps === null ? '—' : `${percentage.toFixed(1)}%`}
        </span>
      }
    >
      <Bar percentage={percentage} color={color} />
      <div className="t-micro mt-1 flex items-center justify-between gap-2 text-gray-500">
        <span className="font-mono text-gray-400">{formatRate(usage)}</span>
        <span>of {formatLinkSpeed(data.network.linkSpeedMbps)}</span>
      </div>
    </Card>
  );
};

// --- Logs / security -------------------------------------------------------

const AlertsCard: React.FC<{ data: DashboardData; now: number | null }> = ({ data, now }) => (
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
  </Card>
);

const ProcessesCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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
            className={cn('w-[5ch] text-right', sortBy === 'cpu' ? 'text-yellow-400' : 'text-yellow-400/60')}
          >
            CPU
          </span>
          <span className={cn('w-[5ch] text-right', sortBy === 'mem' ? 'text-blue-400' : 'text-blue-400/60')}>
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
              <span className="w-[5ch] text-right text-yellow-400">{process.cpu.toFixed(1)}</span>
              <span className="w-[5ch] text-right text-blue-400">{process.memory.toFixed(1)}</span>
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

const TrafficCard: React.FC<{ data: DashboardData }> = ({ data }) => (
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

const FirewallCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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
