'use client';

import React from 'react';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';

import { linePath } from '@/components/charts/paths';
import { describeSlope } from '@/components/overview/trend';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { PALETTE } from '@/lib/theme';
import type { CapacityForecast } from '@/types/system';
import type { DashboardData } from '@/utils/dashboardData';

// "When does it fill?" for disk and memory: the server's 14-day least-squares
// trend over the persisted hourly history, its daily averages as a sparkline,
// and the growth per day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The server needs this many days of history before it fits a trend.
const MIN_DAYS = 3;

function fullIn(hours: number): string {
  return hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`;
}

function Row({
  name,
  now,
  forecast,
  nowMs
}: {
  name: string;
  now: number;
  forecast: CapacityForecast;
  nowMs: number;
}) {
  const { ratePerDay, hoursToFull, daily } = forecast;
  const known = daily.filter((value): value is number => value !== null);
  const low = Math.max(0, Math.floor(Math.min(...known, now) - 2));
  const high = Math.min(100, Math.ceil(Math.max(...known, now) + 2));
  const trending = ratePerDay !== null;
  const eta = hoursToFull !== null ? new Date(nowMs + hoursToFull * 3_600_000) : null;

  return (
    <div className="flex flex-col gap-2.5 border-b border-line-soft px-[18px] py-3.5">
      <div className="flex items-baseline gap-2.5">
        <span className="flex-1 text-[13px]">{name}</span>
        <span className="font-mono text-[13px]">{now.toFixed(1)}%</span>
        <span className="font-mono text-[11.5px] text-subtle">
          {trending ? describeSlope(ratePerDay) : `needs at least ${MIN_DAYS} days`}
        </span>
      </div>
      <svg viewBox="0 0 200 32" preserveAspectRatio="none" className="block h-8 w-full">
        <path
          d={linePath(daily, { x: 0, y: 1, width: 200, height: 30 }, high, low)}
          fill="none"
          stroke={eta ? PALETTE.accent : PALETTE.faint}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between gap-2.5 text-xs">
        {eta && hoursToFull !== null ? (
          <>
            <span className="text-fg">Full in ~{fullIn(hoursToFull)}</span>
            <span className="font-mono text-[11.5px] text-subtle">
              around {MONTHS[eta.getMonth()]} {eta.getDate()}, {eta.getFullYear()}
            </span>
          </>
        ) : trending ? (
          <>
            <span className="text-muted">Not trending toward full</span>
            <span className="font-mono text-[11.5px] text-subtle">
              14-day slope ≈ {Math.abs(ratePerDay) < 0.01 ? '0' : describeSlope(ratePerDay)}
            </span>
          </>
        ) : (
          <>
            <span className="text-muted">Collecting history</span>
            <span className="font-mono text-[11.5px] text-subtle">
              {forecast.daysWithData} of {MIN_DAYS} days
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function CapacityPanel({ data, now }: { data: DashboardData; now: number }) {
  const capacity = data.capacity;
  const enough = capacity !== null && (capacity.disk.ratePerDay !== null || capacity.mem.ratePerDay !== null);
  const threshold = data.thresholds.ALERT_DISKFILL_ENTER_HOURS ?? 24;

  return (
    <Panel
      className="flex flex-[1_1_320px] flex-col"
      title="Capacity forecast"
      actions={<span className="font-mono text-[11px] text-subtle">14-day linear trend</span>}
    >
      {!enough || capacity === null ? (
        <EmptyState
          icon={TrendingUp}
          title="Not enough history yet"
          body={`Forecasts need at least ${MIN_DAYS} days of samples to estimate a trend.`}
        />
      ) : (
        <>
          <Row name="Disk /" now={data.disk.percentage} forecast={capacity.disk} nowMs={now} />
          <Row name="Memory" now={data.memory.percentage} forecast={capacity.mem} nowMs={now} />
        </>
      )}
      <div className="mt-auto px-[18px] py-3 text-xs text-subtle">
        Alerts when a forecast drops under <span className="font-mono text-fg-2">{threshold}h</span> ·{' '}
        <Link href="/settings/rules">Edit rule</Link>
      </div>
    </Panel>
  );
}
