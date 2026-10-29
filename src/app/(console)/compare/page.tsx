'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';

import { CompareChart } from '@/components/compare/CompareChart';
import {
  METRIC_LABELS,
  PERIOD_LABELS,
  bucketDefs,
  delta,
  foldPoints,
  formatValue,
  periodWindow,
  stat,
  type CompareMetric,
  type ComparePeriod,
  type Delta,
  type StatKind
} from '@/components/compare/compareData';
import { PageBody } from '@/components/ui/PageBody';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/utils/timeFormat';

// One metric over this day/week/month against the previous one, from the
// persisted hourly history (kept 62 days).

const POLL_MS = 5 * 60_000;
const HOUR = 3_600_000;

const METRICS = (Object.keys(METRIC_LABELS) as CompareMetric[]).map(value => ({
  value,
  label: METRIC_LABELS[value]
}));
const PERIODS = (Object.keys(PERIOD_LABELS) as ComparePeriod[]).map(value => ({
  value,
  label: PERIOD_LABELS[value].title
}));
const STATS: { kind: StatKind; label: string }[] = [
  { kind: 'avg', label: 'Average' },
  { kind: 'p95', label: '95th percentile' },
  { kind: 'max', label: 'Peak' }
];

const DELTA_STYLE: Record<Delta['tone'], string> = {
  up: 'bg-warn/12 text-warn-fg',
  down: 'bg-ok/10 text-ok-fg',
  flat: 'bg-white/6 text-fg-3',
  none: 'bg-white/6 text-muted'
};

function DeltaTag({ value }: { value: Delta }) {
  return (
    <span className={cn('rounded px-[7px] py-0.5 font-mono text-[11px]', DELTA_STYLE[value.tone])}>
      {value.text}
    </span>
  );
}

const rangeUrl = (metric: CompareMetric, from: number, to: number) =>
  `/api/history/range?metric=${metric}&from=${from}&to=${to}`;

export default function ComparePage() {
  const now = useNow();
  const [metric, setMetric] = useState<CompareMetric>('cpu');
  const [period, setPeriod] = useState<ComparePeriod>('week');

  // Fetch windows are fixed per period/hour so the shared poll cache is reused.
  const hour = now === null ? null : Math.floor(now / HOUR) * HOUR;
  const span = hour === null ? null : periodWindow(period, hour);
  const currentRaw = usePolled<(number | null)[]>(
    span ? rangeUrl(metric, span.start, span.end) : null,
    POLL_MS
  );
  const previousRaw = usePolled<(number | null)[]>(
    span ? rangeUrl(metric, span.prevStart, span.prevEnd) : null,
    POLL_MS
  );

  if (now === null || span === null) return null;

  const labels = PERIOD_LABELS[period];
  const current = foldPoints(currentRaw ?? [], span.hoursPerPoint);
  const previous = foldPoints(previousRaw ?? [], span.hoursPerPoint);
  const nowIndex = Math.max(0, Math.floor((now - span.start) / (span.hoursPerPoint * HOUR)));
  // Compare like with like: both periods up to the same point.
  const currentSoFar = current.slice(0, nowIndex + 1);
  const previousSoFar = previous.slice(0, nowIndex + 1);
  const previousEmpty = previousRaw !== null && previousRaw.every(value => value === null);
  const points = Math.max(current.length, previous.length);
  const pointLabels = Array.from({ length: points }, (_, i) => {
    const at = span.start + i * span.hoursPerPoint * HOUR;
    if (period === 'month') return `Day ${i + 1}`;
    const stamp = formatTimestamp(at);
    return period === 'week'
      ? `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Math.floor(i / 24)]} ${stamp.slice(11, 16)}`
      : stamp.slice(11, 16);
  });

  const buckets = bucketDefs(period, points).map(bucket => {
    const cur =
      bucket.from <= nowIndex
        ? stat(current.slice(bucket.from, Math.min(bucket.to, nowIndex + 1)), 'avg')
        : null;
    const prev = stat(previous.slice(bucket.from, bucket.to), 'avg');
    return { ...bucket, cur, prev };
  });
  const bucketMax = Math.max(1e-9, ...buckets.map(bucket => Math.max(bucket.cur ?? 0, bucket.prev ?? 0)));

  return (
    <PageBody className="max-w-[1400px]">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <Segmented options={METRICS} value={metric} onChange={setMetric} label="Metric" />
        <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Period" />
        <span className="ml-auto text-xs text-dim">
          Both periods are compared up to the same point (
          {formatTimestamp(now).slice(period === 'day' ? 11 : 5, 16)}).
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {STATS.map(({ kind, label }) => {
          const cur = stat(currentSoFar, kind);
          const prev = previousEmpty ? null : stat(previousSoFar, kind);
          return (
            <div
              key={kind}
              className="flex flex-col gap-2 rounded-[10px] border border-line bg-card px-[18px] py-3.5"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-muted">{label}</span>
                <DeltaTag value={delta(cur, prev)} />
              </div>
              <span className="font-mono text-2xl font-medium tracking-[-0.02em]">
                {formatValue(metric, cur)}
              </span>
              <span className="text-xs text-subtle">
                vs <span className="font-mono text-fg-3">{formatValue(metric, prev)}</span>{' '}
                {labels.previous.toLowerCase()}
              </span>
            </div>
          );
        })}
      </div>

      <Panel
        title={`${METRIC_LABELS[metric]} · ${labels.title}`}
        actions={
          <>
            <span className="flex items-center gap-[7px] text-xs text-muted">
              <span className="h-0.5 w-3.5 bg-accent" />
              {labels.current}
            </span>
            <span className="flex items-center gap-[7px] text-xs text-muted">
              <span className="w-3.5 border-t-2 border-dashed border-dim" />
              {labels.previous}
            </span>
          </>
        }
      >
        <div className="px-[18px] pt-3.5 pb-3">
          {previousEmpty && (
            <div className="mb-2.5 flex items-center gap-2 rounded-[7px] bg-inset px-3 py-[9px] text-[12.5px] text-fg-3">
              <Info size={14} className="shrink-0 text-dim" />
              No data for the previous period yet. The comparison fills in after one full period of history.
            </div>
          )}
          <CompareChart
            metric={metric}
            current={current}
            previous={previous}
            nowIndex={nowIndex}
            labels={pointLabels}
            xLabels={span.xLabels}
            currentLabel={labels.current}
            previousLabel={labels.previous}
          />
        </div>
      </Panel>

      <Panel
        className="overflow-hidden"
        title={
          period === 'day'
            ? 'Average by 4-hour block'
            : period === 'week'
              ? 'Average by day'
              : 'Average by week'
        }
      >
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_90px_minmax(0,1.2fr)] gap-3 px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint">
              <span>Period</span>
              <span className="text-right">{labels.current}</span>
              <span className="text-right">{labels.previous}</span>
              <span className="text-right">Change</span>
              <span />
            </div>
            {buckets.map(bucket => (
              <div
                key={bucket.label}
                className="grid grid-cols-[minmax(0,1fr)_110px_110px_90px_minmax(0,1.2fr)] items-center gap-3 border-t border-line-soft px-[18px] py-[9px] text-[12.5px]"
              >
                <span>{bucket.label}</span>
                <span className="text-right font-mono">{formatValue(metric, bucket.cur)}</span>
                <span className="text-right font-mono text-muted">{formatValue(metric, bucket.prev)}</span>
                <span className="text-right">
                  <DeltaTag value={delta(bucket.cur, bucket.prev)} />
                </span>
                <span className="flex flex-col gap-[3px]">
                  <span
                    className="h-[5px] rounded-[3px] bg-accent"
                    style={{ width: `${((bucket.cur ?? 0) / bucketMax) * 100}%` }}
                  />
                  <span
                    className="h-[5px] rounded-[3px] bg-divider"
                    style={{ width: `${((bucket.prev ?? 0) / bucketMax) * 100}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </PageBody>
  );
}
