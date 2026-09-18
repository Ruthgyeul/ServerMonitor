import React from 'react';
import {
  Activity,
  Clock,
  Cpu,
  Fan,
  HardDriveDownload,
  MemoryStick,
  Thermometer,
  TrendingUp
} from 'lucide-react';

import { Bar, Sparkline } from '@/components/charts/primitives';
import { DiskIoPoint } from '@/hooks/useSystemData';
import { cn } from '@/lib/utils';
import { loadCellColor, loadColor, statusColor, tempColor } from '@/lib/statusColors';
import { DashboardData } from '@/utils/dashboardData';
import { formatMbPair, formatShortDateTime } from '@/utils/format';

import { Card, Empty } from './shared';

// Above this, the core bars fold onto two rows.
const CORE_SPLIT_THRESHOLD = 8;
const MAX_CORE_BARS = 16;
const LOAD_CELLS = 48;
// The 30-minute moving-average window length. Same value as ROLLING_WINDOW_MS in
// history.ts; used here only to decide "is the window full".
const ROLLING_30M_SECONDS = 30 * 60;
const TEMP_SCALE_MAX = 90;
const TEMP_WARN = 65;
const TEMP_CRITICAL = 74;

export const UptimeCard: React.FC<{ data: DashboardData }> = ({ data }) => (
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

export const LoadCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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
        <span>
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

export const CoresCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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

// A compact 24h trend line drawn from the persisted per-metric history. Renders
// nothing until at least two hourly points exist, so it never adds height on a
// fresh start (keeps the kiosk layout budget intact). Only used by TemperatureCard.
const TrendSparkline: React.FC<{ samples?: { value: number | null }[]; color: string; label: string }> = ({
  samples,
  color,
  label
}) => {
  const slots = (samples ?? []).map(sample => sample.value);
  // Need two real points to draw; keep the null slots so gaps stay at their true
  // position in the 24h window rather than compressing.
  if (slots.filter((v): v is number => v !== null).length < 2) return null;
  return (
    <div className="dash-tip mt-1 h-4" tabIndex={-1} data-tip={`${label} — last 24h`}>
      <Sparkline series={[{ key: label, values: slots, color }]} />
    </div>
  );
};

export const TemperatureCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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
          className="absolute top-[-1px] h-[7px] w-px bg-amber-400"
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
      <TrendSparkline samples={data.history.trends?.temp} color="#fb923c" label="CPU temp" />
    </Card>
  );
};

export const FanCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  // Which connector the fan is plugged into varies by motherboard, so use the first one that has a value.
  const rpm = [data.fan.cpu, data.fan.case1, data.fan.case2].find(value => value > 0) ?? 0;

  return (
    <Card icon={Fan} color="#c084fc" title="FAN">
      <div className="t-hero font-bold text-white">{rpm > 0 ? rpm.toLocaleString() : 'N/A'}</div>
      <div className="t-micro text-gray-400">RPM</div>
    </Card>
  );
};

export const SwapCard: React.FC<{ data: DashboardData }> = ({ data }) => {
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

export const DiskIoCard: React.FC<{ data: DashboardData; history: DiskIoPoint[] }> = ({ data, history }) => {
  const io = formatMbPair(data.diskIO.read, data.diskIO.write);

  return (
    <Card
      icon={HardDriveDownload}
      color="#38bdf8"
      title="DISK I/O"
      right={
        <span className="t-micro shrink-0 whitespace-nowrap font-mono">
          <span className="text-sky-400">R {io.read}</span>{' '}
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

// Reuses the disk/memory fill-forecast (see diskTrend.ts/memTrend.ts): a
// linear projection from the last 6h trend, null when a resource isn't
// currently trending toward full.
function formatForecast(hours: number): string {
  return hours < 48 ? `~${hours.toFixed(1)}h` : `~${Math.round(hours / 24)}d`;
}

export const CapacityCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const rows: { label: string; hours: number | null }[] = [
    { label: 'Disk', hours: data.disk.hoursToFull },
    { label: 'Memory', hours: data.memory.hoursToFull }
  ];
  const forecasting = rows.filter((row): row is { label: string; hours: number } => row.hours !== null);

  return (
    <Card icon={TrendingUp} color="#a78bfa" title="CAPACITY PLANNING">
      {forecasting.length === 0 ? (
        <Empty>no resource is trending toward full</Empty>
      ) : (
        // A single wrapping line rather than a <ul> of per-item rows, so the
        // common one-or-two-forecast case stays as compact as any other
        // <Empty> card — the 7" kiosk layout has no headroom for a growing list.
        <p className="t-body flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono">
          {forecasting.map(row => (
            <span key={row.label}>
              <span className="text-gray-400">{row.label} </span>
              <span className={row.hours < 24 ? 'text-red-400' : 'text-amber-400'}>
                fills in {formatForecast(row.hours)}
              </span>
            </span>
          ))}
        </p>
      )}
    </Card>
  );
};
