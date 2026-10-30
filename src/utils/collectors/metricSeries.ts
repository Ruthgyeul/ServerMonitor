import fs from 'fs';
import path from 'path';

import { HistoryRange, MetricPoint, MetricSeries, MetricWindow, WindowMetric } from '@/types/system';
import {
  addToBucket,
  type Bucket,
  getRange,
  getSeries,
  HOUR_MS,
  type HistoryMetric,
  QUARTER_MS,
  quarterCoversFrom
} from '@/utils/collectors/history';
import { round } from '@/utils/collectors/shell';
import { processSingleton } from '@/utils/processSingleton';

// Chart series for the overview (KPI sparklines, network chart, hardware
// sparklines) and the incident context charts.
//
//   1h   60 × 1 min    from the minute tier (persisted, kept 6h)
//   6h   72 × 5 min    from the minute tier
//   24h  96 × 15 min   from history's 15-minute tier
//   7d  168 × 1 h      from history's hourly tier

const MINUTE_MS = 60_000;
const MINUTE_RETENTION = 6 * 60;
const SAVE_INTERVAL_MS = 60_000;

const METRICS = [
  'cpu',
  'mem',
  'disk',
  'down',
  'up',
  'load',
  'temp',
  'swap',
  'diskRead',
  'diskWrite'
] as const;
type Metric = (typeof METRICS)[number];
export type MinuteSample = Partial<Record<Metric, number | null>>;

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.MINUTES_FILE || path.join(DATA_DIR, 'minutes.json');
const STORE_VERSION = 1;

type MinuteBuckets = Record<Metric, Map<number, Bucket>>;

const state = processSingleton('metricSeries', () => ({
  buckets: Object.fromEntries(METRICS.map(metric => [metric, new Map()])) as MinuteBuckets,
  loaded: false,
  lastSaveAt: 0,
  saveTimer: null as ReturnType<typeof setTimeout> | null,
  exitHooked: false
}));

// How each range is drawn.
const RANGES: Record<
  HistoryRange,
  { stepMinutes: number; points: number; source: 'minute' | 'quarter' | 'hour' }
> = {
  '1h': { stepMinutes: 1, points: 60, source: 'minute' },
  '6h': { stepMinutes: 5, points: 72, source: 'minute' },
  '24h': { stepMinutes: 15, points: 96, source: 'quarter' },
  '7d': { stepMinutes: 60, points: 168, source: 'hour' }
};

export function isHistoryRange(value: string): value is HistoryRange {
  return value in RANGES;
}

// --- Persistence -----------------------------------------------------------

type SerializedBucket = [key: number, sum: number, count: number, max: number];

function ensureLoaded(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')) as {
      v?: number;
      buckets?: Partial<Record<Metric, SerializedBucket[]>>;
    };
    if (parsed?.v !== STORE_VERSION || !parsed.buckets) return;
    const oldest = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - (MINUTE_RETENTION - 1) * MINUTE_MS;
    for (const metric of METRICS) {
      for (const row of parsed.buckets[metric] ?? []) {
        if (!Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite)) continue;
        const [key, sum, count, max] = row;
        if (count > 0 && key >= oldest) state.buckets[metric].set(key, { sum, count, max });
      }
    }
  } catch {
    // First run or unreadable: start empty.
  }
}

function payload() {
  return {
    v: STORE_VERSION,
    buckets: Object.fromEntries(
      METRICS.map(metric => [
        metric,
        [...state.buckets[metric].entries()].map(([key, bucket]) => [
          key,
          bucket.sum,
          bucket.count,
          bucket.max
        ])
      ])
    )
  };
}

function scheduleSave(): void {
  if (state.saveTimer) return;
  const delay = Math.max(0, SAVE_INTERVAL_MS - (Date.now() - state.lastSaveAt));
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    state.lastSaveAt = Date.now();
    void fs.promises
      .mkdir(DATA_DIR, { recursive: true })
      .then(() => fs.promises.writeFile(`${STORE_FILE}.tmp`, JSON.stringify(payload()), 'utf-8'))
      .then(() => fs.promises.rename(`${STORE_FILE}.tmp`, STORE_FILE))
      .catch(() => {
        /* retried on the next save */
      });
  }, delay);
  if (typeof state.saveTimer.unref === 'function') state.saveTimer.unref();
}

function hookExit(): void {
  if (state.exitHooked) return;
  state.exitHooked = true;
  const flush = () => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(payload()), 'utf-8');
    } catch {
      // shutting down
    }
  };
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
  process.once('beforeExit', flush);
}

// --- Recording -------------------------------------------------------------

export function recordMinuteSample(sample: MinuteSample, at: number = Date.now()): void {
  ensureLoaded();
  hookExit();
  const key = Math.floor(at / MINUTE_MS) * MINUTE_MS;
  const oldest = key - (MINUTE_RETENTION - 1) * MINUTE_MS;
  for (const metric of METRICS) {
    const value = sample[metric];
    const buckets = state.buckets[metric];
    if (typeof value === 'number' && Number.isFinite(value)) addToBucket(buckets, key, value);
    for (const bucketKey of buckets.keys()) {
      if (bucketKey < oldest) buckets.delete(bucketKey);
    }
  }
  scheduleSave();
}

// --- Reading ---------------------------------------------------------------

// Average the minute buckets of one metric over [start, start + width).
function averageMinutes(metric: Metric, start: number, width: number): number | null {
  let sum = 0;
  let count = 0;
  for (let key = start; key < start + width; key += MINUTE_MS) {
    const bucket = state.buckets[metric].get(key);
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
    const point = Object.fromEntries(METRICS.map(metric => [metric, averageMinutes(metric, start, width)]));
    return { at: new Date(start).toISOString(), ...point } as MetricPoint;
  });
}

// History has no disk I/O series; those stay null on the long ranges.
const HISTORY_FIELDS: [keyof MetricPoint, HistoryMetric][] = [
  ['cpu', 'cpu'],
  ['mem', 'mem'],
  ['disk', 'disk'],
  ['down', 'down'],
  ['up', 'up'],
  ['load', 'load'],
  ['temp', 'temp'],
  ['swap', 'swap']
];

function fromHistory(stepMs: number, points: number, now: number): MetricPoint[] {
  const columns = HISTORY_FIELDS.map(
    ([field, metric]) => [field, getSeries(metric, stepMs, points, now)] as const
  );
  const [, first] = columns[0];
  return first.map((sample, index) => {
    const point: Record<string, number | string | null> = { at: sample.at, diskRead: null, diskWrite: null };
    for (const [field, values] of columns) point[field] = values[index]?.value ?? null;
    return point as unknown as MetricPoint;
  });
}

export function getMetricSeries(range: HistoryRange, now: number = Date.now()): MetricSeries {
  ensureLoaded();
  const spec = RANGES[range];
  const points =
    spec.source === 'minute'
      ? fromMinutes(spec.stepMinutes, spec.points, now)
      : fromHistory(spec.source === 'quarter' ? QUARTER_MS : HOUR_MS, spec.points, now);
  return { range, stepSeconds: spec.stepMinutes * 60, points };
}

// --- Windows (incident context) -------------------------------------------

const MAX_WINDOW_POINTS = 120;
const WINDOW_TO_HISTORY: Record<Exclude<WindowMetric, 'net'>, HistoryMetric> = {
  cpu: 'cpu',
  mem: 'mem',
  disk: 'disk',
  temp: 'temp',
  swap: 'swap',
  load: 'load'
};

function minuteValue(metric: WindowMetric, start: number, width: number): number | null {
  if (metric !== 'net') return averageMinutes(metric, start, width);
  const down = averageMinutes('down', start, width);
  const up = averageMinutes('up', start, width);
  return down === null && up === null ? null : round((down ?? 0) + (up ?? 0), 2);
}

// One metric over [from, to], from the finest tier still holding `from`:
// minutes (last 6h), 15-minute buckets (last 8 days), else hourly.
export function getMetricWindow(
  metric: WindowMetric,
  from: number,
  to: number,
  now: number = Date.now()
): MetricWindow {
  ensureLoaded();
  const end = Math.min(to, now);
  if (from >= now - MINUTE_RETENTION * MINUTE_MS) {
    const stepMinutes = Math.max(1, Math.ceil((end - from) / MINUTE_MS / MAX_WINDOW_POINTS));
    const width = stepMinutes * MINUTE_MS;
    const start = Math.floor(from / width) * width;
    const count = Math.max(1, Math.ceil((end - start) / width));
    return {
      metric,
      stepSeconds: stepMinutes * 60,
      points: Array.from({ length: count }, (_, index) => {
        const at = start + index * width;
        return { at: new Date(at).toISOString(), value: minuteValue(metric, at, width) };
      })
    };
  }
  const stepMs = from >= quarterCoversFrom(now) ? QUARTER_MS : HOUR_MS;
  const start = Math.floor(from / stepMs) * stepMs;
  const values =
    metric === 'net'
      ? getRange('net', start, end, stepMs)
      : getRange(WINDOW_TO_HISTORY[metric], start, end, stepMs);
  return {
    metric,
    stepSeconds: stepMs / 1000,
    points: values.map((value, index) => ({ at: new Date(start + index * stepMs).toISOString(), value }))
  };
}
