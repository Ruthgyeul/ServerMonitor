'use client';

import React, { useState } from 'react';

import { HoverSparkline } from '@/components/charts/HoverSparkline';
import { niceMax } from '@/components/charts/paths';
import { RANGES, eventMarks, pointLabel, withLive } from '@/components/overview/chartData';
import { Segmented, optionsOf } from '@/components/ui/Segmented';
import { usePolled } from '@/hooks/usePolled';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { AlertLevel, HistoryRange, HostEvent, MetricPoint, MetricSeries } from '@/types/system';
import type { DashboardData } from '@/utils/dashboardData';

// The four headline cards: value, state chip, sparkline over a per-card range,
// a usage bar with the alert threshold marked, and a caption.

// How often each range's series is refreshed (the live value updates every tick).
const POLL_MS: Record<HistoryRange, number> = { '1h': 30_000, '6h': 60_000, '24h': 300_000, '7d': 300_000 };

export function historyUrl(range: HistoryRange): string {
  return `/api/history?range=${range}`;
}

export function useMetricSeries(range: HistoryRange): MetricSeries | null {
  return usePolled<MetricSeries>(historyUrl(range), POLL_MS[range]);
}

const fmt = (value: number) =>
  Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(value !== 0 && value < 1 ? 2 : 1);

interface KpiSpec {
  label: string;
  value: number;
  unit: string;
  // 0–100 fill of the bar under the sparkline.
  percent: number;
  caption: string;
  // Rule key in activeAlerts that marks this card as firing.
  alertKey: string | null;
  // Threshold (env name) drawn as a tick on the bar.
  thresholdKey: string | null;
  pick: (point: MetricPoint) => number | null;
  percentScale: boolean;
}

const STATE_STYLE: Record<'normal' | 'pending' | AlertLevel, { label: string; className: string }> = {
  normal: { label: 'normal', className: 'bg-ok/10 text-ok-fg' },
  // Breached but still inside the fire delay.
  pending: { label: 'pending', className: 'bg-warn/12 text-warn-fg' },
  ok: { label: 'normal', className: 'bg-ok/10 text-ok-fg' },
  info: { label: 'info', className: 'bg-accent/12 text-info-fg' },
  warning: { label: 'warning', className: 'bg-warn/12 text-warn-fg' },
  critical: { label: 'critical', className: 'bg-crit/14 text-crit-fg' }
};

function KpiCard({
  spec,
  data,
  events,
  now,
  showEvents
}: {
  spec: KpiSpec;
  data: DashboardData;
  events: HostEvent[];
  now: number;
  showEvents: boolean;
}) {
  const [range, setRange] = useState<HistoryRange>('1h');
  const series = useMetricSeries(range);
  const points = series?.points ?? [];
  const values = withLive(points.map(spec.pick), spec.value, range);
  const labels = points.map(point => pointLabel(point.at, range));

  const firing = spec.alertKey ? data.activeAlerts.find(alert => alert.key === spec.alertKey) : undefined;
  const pending =
    !firing && spec.alertKey
      ? data.pendingAlerts.some(alert => alert.key === spec.alertKey && alert.state === 'pending')
      : false;
  const state = STATE_STYLE[firing?.level ?? (pending ? 'pending' : 'normal')];
  const peak = Math.max(0, ...values.filter((value): value is number => value !== null));
  const max = spec.percentScale ? Math.min(100, niceMax(peak)) : niceMax(peak);
  const threshold = spec.thresholdKey ? data.thresholds[spec.thresholdKey] : undefined;

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-[10px] border bg-card px-[18px] pt-4 pb-3.5',
        firing ? 'border-crit/35' : 'border-line'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-muted">{spec.label}</span>
        <span className={cn('rounded px-1.5 py-px font-mono text-[10.5px]', state.className)}>
          {state.label}
        </span>
        <div className="ml-auto">
          <Segmented
            options={optionsOf(RANGES)}
            value={range}
            onChange={setRange}
            size="xs"
            label={`${spec.label} range`}
          />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[30px] font-medium tracking-[-0.03em]">{fmt(spec.value)}</span>
        <span className="font-mono text-[13px] text-subtle">{spec.unit}</span>
      </div>
      <HoverSparkline
        values={values}
        labels={labels.length ? labels : ['now']}
        max={max}
        stroke={firing ? PALETTE.crit : PALETTE.accent}
        fill={firing ? 'rgba(239,95,90,0.10)' : 'rgba(90,169,240,0.10)'}
        format={value => `${fmt(value)}${spec.unit === '%' ? '%' : ` ${spec.unit}`}`}
        marks={showEvents ? eventMarks(events, range, now) : []}
      />
      <div className="flex flex-col gap-1.5">
        <div className="relative h-1 rounded-sm bg-track">
          <div
            className={cn('h-full rounded-sm', firing ? 'bg-crit' : 'bg-accent')}
            style={{ width: `${Math.min(100, Math.max(0, spec.percent))}%` }}
          />
          {threshold !== undefined && (
            <div
              title={`alert at ${threshold}${spec.unit}`}
              className="absolute -top-0.5 h-2 w-px bg-dim"
              style={{ left: `${Math.min(100, threshold)}%` }}
            />
          )}
        </div>
        <span className="font-mono text-[11.5px] text-subtle">{spec.caption}</span>
      </div>
    </section>
  );
}

function specsFor(data: DashboardData): KpiSpec[] {
  const { cpu, memory, disk, network, load } = data;
  const net = network.download + network.upload;
  return [
    {
      label: 'CPU',
      value: cpu.usage,
      unit: '%',
      percent: cpu.usage,
      caption: `${cpu.cores} cores · load ${load.avg1.toFixed(2)}`,
      alertKey: 'cpu',
      thresholdKey: 'ALERT_CPU_ENTER',
      pick: point => point.cpu,
      percentScale: true
    },
    {
      label: 'Memory',
      value: memory.percentage,
      unit: '%',
      percent: memory.percentage,
      // The collector reports memory in MB.
      caption: `${(memory.used / 1024).toFixed(1)} / ${(memory.total / 1024).toFixed(1)} GB used`,
      alertKey: 'memory',
      thresholdKey: 'ALERT_MEM_ENTER',
      pick: point => point.mem,
      percentScale: true
    },
    {
      label: 'Disk',
      value: disk.percentage,
      unit: '%',
      percent: disk.percentage,
      caption: `${Math.round(disk.used)} / ${Math.round(disk.total)} GB · /`,
      alertKey: 'disk',
      thresholdKey: 'ALERT_DISK_ENTER',
      pick: point => point.disk,
      percentScale: true
    },
    {
      label: 'Network',
      value: net,
      unit: 'KB/s',
      percent: network.bandwidthPercentage,
      caption: `↓ ${network.download.toFixed(1)}  ↑ ${network.upload.toFixed(1)} KB/s`,
      alertKey: null,
      thresholdKey: null,
      pick: point => (point.down === null && point.up === null ? null : (point.down ?? 0) + (point.up ?? 0)),
      percentScale: false
    }
  ];
}

export function KpiCards({
  data,
  events,
  now,
  showEvents
}: {
  data: DashboardData;
  events: HostEvent[];
  now: number;
  // The Network panel's Events toggle applies to the KPI sparklines too.
  showEvents: boolean;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
      {specsFor(data).map(spec => (
        <KpiCard key={spec.label} spec={spec} data={data} events={events} now={now} showEvents={showEvents} />
      ))}
    </div>
  );
}
