'use client';

import React from 'react';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';

import { linePath } from '@/components/charts/paths';
import { useMetricSeries } from '@/components/overview/KpiCards';
import { describeSlope, slopePerDay } from '@/components/overview/trend';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { PALETTE } from '@/lib/theme';
import type { MetricPoint } from '@/types/system';
import type { DashboardData } from '@/utils/dashboardData';

// "When does it fill?" for disk and memory: the server's fill-time estimate,
// the week's trend line and its daily slope.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A trend needs some spread to be meaningful.
const MIN_POINTS = 12;

function Row({
  name,
  now,
  hoursToFull,
  points,
  pick,
  nowMs
}: {
  name: string;
  now: number;
  hoursToFull: number | null;
  points: MetricPoint[];
  pick: (point: MetricPoint) => number | null;
  nowMs: number;
}) {
  const series = points.map(point => ({ at: point.at, value: pick(point) }));
  const values = series.map(point => point.value);
  const known = values.filter((value): value is number => value !== null);
  const low = Math.max(0, Math.floor(Math.min(...known, now) - 2));
  const high = Math.min(100, Math.ceil(Math.max(...known, now) + 2));
  const filling = hoursToFull !== null;
  const eta = filling ? new Date(nowMs + hoursToFull * 3_600_000) : null;

  return (
    <div className="flex flex-col gap-2.5 border-b border-line-soft px-[18px] py-3.5">
      <div className="flex items-baseline gap-2.5">
        <span className="flex-1 text-[13px]">{name}</span>
        <span className="font-mono text-[13px]">{now.toFixed(1)}%</span>
        <span className="font-mono text-[11.5px] text-subtle">{describeSlope(slopePerDay(series))}</span>
      </div>
      <svg viewBox="0 0 200 32" preserveAspectRatio="none" className="block h-8 w-full">
        <path
          d={linePath(values, { x: 0, y: 1, width: 200, height: 30 }, high, low)}
          fill="none"
          stroke={filling ? PALETTE.accent : PALETTE.faint}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between gap-2.5 text-xs">
        {eta ? (
          <>
            <span className="text-fg">
              Full in ~
              {hoursToFull! < 48
                ? `${Math.round(hoursToFull!)} hours`
                : `${Math.round(hoursToFull! / 24)} days`}
            </span>
            <span className="font-mono text-[11.5px] text-subtle">
              around {MONTHS[eta.getMonth()]} {eta.getDate()}, {eta.getFullYear()}
            </span>
          </>
        ) : (
          <>
            <span className="text-muted">Not trending toward full</span>
            <span className="font-mono text-[11.5px] text-subtle">
              7-day slope ≈ {describeSlope(slopePerDay(series))}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function CapacityPanel({ data, now }: { data: DashboardData; now: number }) {
  const week = useMetricSeries('7d');
  const points = week?.points ?? [];
  const enough = points.filter(point => point.disk !== null).length >= MIN_POINTS;
  const threshold = data.thresholds.ALERT_DISKFILL_ENTER_HOURS ?? 24;

  return (
    <Panel
      className="flex flex-[1_1_320px] flex-col"
      title="Capacity forecast"
      actions={<span className="font-mono text-[11px] text-subtle">7-day linear trend</span>}
    >
      {!enough ? (
        <EmptyState
          icon={TrendingUp}
          title="Not enough history yet"
          body="Forecasts need about half a day of hourly samples to estimate a trend."
        />
      ) : (
        <>
          <Row
            name="Disk /"
            now={data.disk.percentage}
            hoursToFull={data.disk.hoursToFull}
            points={points}
            pick={point => point.disk}
            nowMs={now}
          />
          <Row
            name="Memory"
            now={data.memory.percentage}
            hoursToFull={data.memory.hoursToFull}
            points={points}
            pick={point => point.mem}
            nowMs={now}
          />
        </>
      )}
      <div className="mt-auto px-[18px] py-3 text-xs text-subtle">
        Alerts when a forecast drops under <span className="font-mono text-fg-2">{threshold}h</span> ·{' '}
        <Link href="/alerts/settings">Edit rule</Link>
      </div>
    </Panel>
  );
}
