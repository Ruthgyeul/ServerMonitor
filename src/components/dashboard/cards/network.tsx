import React from 'react';
import { Cpu, HardDrive, LucideIcon, MemoryStick, Monitor, Network, TrendingUp } from 'lucide-react';

import { NetworkAreaChart } from '@/components/charts/NetworkAreaChart';
import { Bar, Gauge, Sparkline } from '@/components/charts/primitives';
import { useBandwidthHistory } from '@/hooks/useBandwidthHistory';
import { cn } from '@/lib/utils';
import { COLORS, heatColor, statusColor } from '@/lib/statusColors';
import { NetworkHistoryEntry } from '@/types/system';
import { DashboardData } from '@/utils/dashboardData';
import { formatBytes, formatLinkSpeed, formatRate } from '@/utils/format';

import { Card, Empty } from './shared';

// Drawing docker/bridge/veth too would let one card eat an entire column.
const MAX_INTERFACES = 4;

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
  // Emphasise a gauge in the critical band with a pulsing ring. `ring` is a
  // box-shadow, so it adds no size — the fixed/kiosk layout is unaffected.
  const alerting = percentage !== null && color === COLORS.critical;

  return (
    <section
      className={cn(
        'gauge-card dash-card flex min-w-0 flex-col items-center rounded-lg border border-gray-700 bg-gray-800',
        alerting && 'animate-[alertBlink_1.2s_ease-in-out_infinite] ring-2 ring-red-500/50'
      )}
    >
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

export const GaugeRow: React.FC<{ data: DashboardData }> = ({ data }) => {
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

export const CpuDayCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Card icon={Cpu} color="#fb923c" title="CPU LOAD — LAST 24H">
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

export const NetworkCard: React.FC<{ data: DashboardData; history: NetworkHistoryEntry[] }> = ({
  data,
  history
}) => (
  <Card
    icon={Network}
    color="#22d3ee"
    title="NETWORK ACTIVITY"
    right={
      <span className="t-micro shrink-0 whitespace-nowrap font-mono">
        <span className="text-sky-400">↓ {formatRate(data.network.download)}</span>{' '}
        <span className="text-emerald-400">↑ {formatRate(data.network.upload)}</span>
      </span>
    }
  >
    {/* Show the since-boot cumulative totals in the legend so bandwidth usage —
        which the instantaneous rate alone can't tell you — is visible at a glance. */}
    <div className="t-micro flex items-center justify-center gap-4 text-gray-400">
      <span className="flex items-center gap-1">
        <span className="h-[7px] w-[7px] rounded-full bg-sky-500" />
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
export const NetworkStripCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <section className="dash-card flex flex-wrap items-center justify-around gap-x-4 gap-y-1 rounded-lg border border-gray-700 bg-gray-800">
    <StripItem value={data.network.ping.toFixed(1)} unit="ms ping" color="text-amber-400" />
    <StripItem
      value={`${data.network.errorRates.rx}/${data.network.errorRates.tx}%`}
      unit="err"
      color="text-red-400"
    />
    <StripItem value={String(data.network.connections)} unit="conns" color="text-emerald-400" />
    <StripItem value={String(data.network.listeningPorts)} unit="ports" color="text-sky-400" />
  </section>
);

const StripItem: React.FC<{ value: string; unit: string; color: string }> = ({ value, unit, color }) => (
  <div className="t-body whitespace-nowrap">
    <span className={cn('font-mono', color)}>{value}</span>
    <span className="text-gray-500"> {unit}</span>
  </div>
);

export const InterfacesCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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
              className={cn(
                'shrink-0 font-mono',
                entry.state === 'up' ? 'text-emerald-400' : 'text-gray-500'
              )}
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

export const BandwidthCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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

// Self-fetching, unlike every other card here: monthly totals change far too
// slowly to ride the 1s SSE stream the rest of the dashboard uses, so this
// polls its own low-frequency endpoint (see /api/bandwidth and
// useBandwidthHistory) instead of taking the value as a prop.
export const BandwidthHistoryCard: React.FC = () => {
  const { days } = useBandwidthHistory();
  const total = days?.reduce((acc, day) => ({ down: acc.down + day.downloadMB, up: acc.up + day.uploadMB }), {
    down: 0,
    up: 0
  });

  return (
    <Card icon={TrendingUp} color="#a78bfa" title="MONTHLY BANDWIDTH">
      {!days || days.length === 0 || !total ? (
        <Empty>collecting daily totals…</Empty>
      ) : (
        <>
          <div className="t-micro flex items-center justify-center gap-4 text-gray-400">
            <span className="flex items-center gap-1">
              <span className="h-[7px] w-[7px] rounded-full bg-sky-500" />↓{' '}
              {formatBytes(total.down * 1024 * 1024)}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-[7px] w-[7px] rounded-full bg-emerald-500" />↑{' '}
              {formatBytes(total.up * 1024 * 1024)}
            </span>
          </div>
          <div className="dash-spark">
            <Sparkline
              series={[
                { key: 'down', values: days.map(day => day.downloadMB), color: '#38bdf8' },
                { key: 'up', values: days.map(day => day.uploadMB), color: '#34d399' }
              ]}
            />
          </div>
          <p className="t-micro mt-1 text-gray-500">last {days.length} days</p>
        </>
      )}
    </Card>
  );
};
