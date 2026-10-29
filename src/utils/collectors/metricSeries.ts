import { HistoryRange, MetricPoint, MetricSeries } from '@/types/system';
import { getHourlySeries } from '@/utils/collectors/history';
import { round } from '@/utils/collectors/shell';

// Chart series for the overview (KPI sparklines and the network chart).
//
// The short ranges (1h, 6h) come from one-minute buckets held in memory — fine
// to lose on restart, they refill within the hour. The long ranges (24h, 7d)
// come from the persisted hourly buckets in history.ts.

const MINUTE_MS = 60_000;
const MINUTE_RETENTION = 6 * 60; // the 6h range is the longest drawn from minutes

const METRICS = ['cpu', 'mem', 'disk', 'down', 'up'] as const;
type Metric = (typeof METRICS)[number];
export type MinuteSample = Partial<Record<Metric, number | null>>;

interface Bucket {
  sum: number;
  count: number;
}

const minuteBuckets: Record<Metric, Map<number, Bucket>> = {
  cpu: new Map(),
  mem: new Map(),
  disk: new Map(),
  down: new Map(),
  up: new Map()
};

// How each range is drawn: bucket width and point count.
const RANGES: Record<HistoryRange, { stepMinutes: number; points: number; source: 'minute' | 'hour' }> = {
  '1h': { stepMinutes: 1, points: 60, source: 'minute' },
  '6h': { stepMinutes: 5, points: 72, source: 'minute' },
  '24h': { stepMinutes: 60, points: 24, source: 'hour' },
  '7d': { stepMinutes: 60, points: 168, source: 'hour' }
};

export function isHistoryRange(value: string): value is HistoryRange {
  return value in RANGES;
}

export function recordMinuteSample(sample: MinuteSample, at: number = Date.now()): void {
  const key = Math.floor(at / MINUTE_MS) * MINUTE_MS;
  const oldest = key - (MINUTE_RETENTION - 1) * MINUTE_MS;
  for (const metric of METRICS) {
    const value = sample[metric];
    const buckets = minuteBuckets[metric];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.sum += value;
        bucket.count += 1;
      } else {
        buckets.set(key, { sum: value, count: 1 });
      }
    }
    for (const bucketKey of buckets.keys()) {
      if (bucketKey < oldest) buckets.delete(bucketKey);
    }
  }
}

// Average the minute buckets of one metric over [start, start + width).
function averageMinutes(metric: Metric, start: number, width: number): number | null {
  let sum = 0;
  let count = 0;
  for (let key = start; key < start + width; key += MINUTE_MS) {
    const bucket = minuteBuckets[metric].get(key);
    if (bucket) {
      sum += bucket.sum;
      count += bucket.count;
    }
  }
  return count > 0 ? round(sum / count, 2) : null;
}

function fromMinutes(stepMinutes: number, points: number, now: number): MetricPoint[] {
  const width = stepMinutes * MINUTE_MS;
  const newest = Math.floor(now / width) * width;
  return Array.from({ length: points }, (_, index) => {
    const start = newest - (points - 1 - index) * width;
    return {
      at: new Date(start).toISOString(),
      cpu: averageMinutes('cpu', start, width),
      mem: averageMinutes('mem', start, width),
      disk: averageMinutes('disk', start, width),
      down: averageMinutes('down', start, width),
      up: averageMinutes('up', start, width)
    };
  });
}

function fromHours(points: number, now: number): MetricPoint[] {
  const [cpu, mem, disk, down, up] = (['cpu', 'mem', 'disk', 'down', 'up'] as const).map(metric =>
    getHourlySeries(metric, points, now)
  );
  return cpu.map((sample, index) => ({
    at: sample.at,
    cpu: sample.value,
    mem: mem[index]?.value ?? null,
    disk: disk[index]?.value ?? null,
    down: down[index]?.value ?? null,
    up: up[index]?.value ?? null
  }));
}

export function getMetricSeries(range: HistoryRange, now: number = Date.now()): MetricSeries {
  const spec = RANGES[range];
  const points =
    spec.source === 'minute' ? fromMinutes(spec.stepMinutes, spec.points, now) : fromHours(spec.points, now);
  return { range, stepSeconds: spec.stepMinutes * 60, points };
}
