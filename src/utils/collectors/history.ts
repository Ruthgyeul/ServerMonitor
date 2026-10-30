import fs from 'fs';
import path from 'path';

import { CpuHourSample, HistoryInfo, LoadSample, TrendSample } from '@/types/system';
import { round } from '@/utils/collectors/shell';
import { processSingleton } from '@/utils/processSingleton';

// Persisted metric history in two tiers, so a restart after a deploy or a
// crash doesn't reset the graphs:
//
//   hour     1-hour buckets, kept HISTORY_RETENTION_DAYS (default 62) — the
//            48h load grid, 24h CPU heatmap, 7d charts and Compare week/month
//   quarter  15-minute buckets, kept 8 days — the 24h charts and Compare's
//            "today vs yesterday" (96 points a day, as the design draws them)
//
// Every bucket keeps sum, count and max, so charts can show averages and
// Compare's "Peak" is the real maximum rather than the highest average.
// The store lives in the gitignored data directory, so pull/build don't touch it.

export const HOUR_MS = 60 * 60 * 1000;
export const QUARTER_MS = 15 * 60 * 1000;

const DEFAULT_RETENTION_DAYS = 62;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 400;
const QUARTER_RETENTION_DAYS = 8;

// Pure: HISTORY_RETENTION_DAYS → whole days, clamped to a sane range.
export function retentionDays(raw: string | undefined): number {
  const days = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.round(days)));
}

const RETENTION_HOURS = retentionDays(process.env.HISTORY_RETENTION_DAYS) * 24;
const QUARTER_RETENTION = QUARTER_RETENTION_DAYS * 96;

// The windows drawn on the overview grids.
const LOAD_DISPLAY = 48; // hours
const CPU_DISPLAY = 24; // hours

const SAVE_INTERVAL_MS = 30 * 1000;

// process.cwd() resolves to the project root at runtime; without this ignore,
// Turbopack's file tracer can't statically scope it and traces the entire
// project into the output bundle (the "unexpected file in NFT list" warning).
const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.HISTORY_FILE || path.join(DATA_DIR, 'history.json');
// v3: two tiers keyed by metric, buckets carry max. v1/v2 files (hourly only,
// one array per metric, no max) are migrated on load.
const STORE_VERSION = 3;

export const HISTORY_METRICS = ['cpu', 'load', 'mem', 'disk', 'temp', 'net', 'down', 'up', 'swap'] as const;
export type HistoryMetric = (typeof HISTORY_METRICS)[number];
export type HourlyMetric = HistoryMetric;
type TrendKey = Exclude<HistoryMetric, 'cpu' | 'load'>;

export interface Bucket {
  sum: number;
  count: number;
  max: number;
}

type TierBuckets = Record<HistoryMetric, Map<number, Bucket>>;

interface Tier {
  bucketMs: number;
  retention: number; // buckets
  buckets: TierBuckets;
}

function emptyBuckets(): TierBuckets {
  return Object.fromEntries(HISTORY_METRICS.map(metric => [metric, new Map()])) as TierBuckets;
}

interface Sample {
  at: number;
  value: number;
}

// Shared by every bundle in the process (see processSingleton), so the
// collection loop and the routes that read history see the same buckets.
const state = processSingleton('history', () => ({
  hour: { bucketMs: HOUR_MS, retention: RETENTION_HOURS, buckets: emptyBuckets() } as Tier,
  quarter: { bucketMs: QUARTER_MS, retention: QUARTER_RETENTION, buckets: emptyBuckets() } as Tier,
  recentLoad: [] as Sample[],
  loaded: false,
  lastSaveAt: 0,
  saveTimer: null as ReturnType<typeof setTimeout> | null,
  writing: false,
  exitHooked: false
}));

// --- 30-minute moving average --------------------------------------------
// The kernel only gives 1/5/15-minute load averages, so the 30-minute one is
// computed from a short window of samples (not persisted; refills after a restart).
const ROLLING_WINDOW_MS = 30 * 60 * 1000;

export interface RollingAverage {
  value: number | null;
  // The span actually covered (seconds), so the caller can tell a partly
  // filled window from a full one.
  windowSeconds: number;
}

function pruneRecent(now: number): void {
  const oldest = now - ROLLING_WINDOW_MS;
  let drop = 0;
  while (drop < state.recentLoad.length && state.recentLoad[drop].at < oldest) drop += 1;
  if (drop > 0) state.recentLoad.splice(0, drop);
}

export function getLoad30mAverage(now: number = Date.now()): RollingAverage {
  pruneRecent(now);
  const recent = state.recentLoad;
  if (recent.length === 0) return { value: null, windowSeconds: 0 };
  const sum = recent.reduce((total, sample) => total + sample.value, 0);
  return {
    value: round(sum / recent.length, 2),
    windowSeconds: Math.min(ROLLING_WINDOW_MS / 1000, Math.round((now - recent[0].at) / 1000))
  };
}

// --- Buckets ---------------------------------------------------------------

export function addToBucket(buckets: Map<number, Bucket>, key: number, value: number): void {
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.sum += value;
    bucket.count += 1;
    bucket.max = Math.max(bucket.max, value);
  } else {
    buckets.set(key, { sum: value, count: 1, max: value });
  }
}

function record(tier: Tier, metric: HistoryMetric, value: number, at: number): void {
  const key = Math.floor(at / tier.bucketMs) * tier.bucketMs;
  const buckets = tier.buckets[metric];
  addToBucket(buckets, key, value);
  const oldest = key - (tier.retention - 1) * tier.bucketMs;
  for (const bucketKey of buckets.keys()) {
    if (bucketKey < oldest) buckets.delete(bucketKey);
  }
}

function recordBoth(metric: HistoryMetric, value: number, at: number): void {
  record(state.hour, metric, value, at);
  record(state.quarter, metric, value, at);
}

// --- Persistence -----------------------------------------------------------

type SerializedBucket = [key: number, sum: number, count: number, max: number];
type SerializedTier = Partial<Record<HistoryMetric, SerializedBucket[]>>;

interface StoreV3 {
  v: 3;
  hour: SerializedTier;
  quarter: SerializedTier;
}

// The v1/v2 layout: hourly arrays per metric, rows without max.
interface LegacyStore {
  v: 1 | 2;
  loadBuckets?: unknown;
  cpuBuckets?: unknown;
  memBuckets?: unknown;
  diskBuckets?: unknown;
  tempBuckets?: unknown;
  netBuckets?: unknown;
  downBuckets?: unknown;
  upBuckets?: unknown;
}

const LEGACY_FIELDS: Record<keyof Omit<LegacyStore, 'v'>, HistoryMetric> = {
  loadBuckets: 'load',
  cpuBuckets: 'cpu',
  memBuckets: 'mem',
  diskBuckets: 'disk',
  tempBuckets: 'temp',
  netBuckets: 'net',
  downBuckets: 'down',
  upBuckets: 'up'
};

function serializeTier(tier: Tier): SerializedTier {
  return Object.fromEntries(
    HISTORY_METRICS.map(metric => [
      metric,
      [...tier.buckets[metric].entries()].map(([key, bucket]) => [key, bucket.sum, bucket.count, bucket.max])
    ])
  );
}

// Rows are [key, sum, count] (v1/v2) or [key, sum, count, max] (v3). A legacy
// row's max is unknown, so its average stands in.
function hydrate(buckets: Map<number, Bucket>, rows: unknown, tier: Tier): void {
  if (!Array.isArray(rows)) return;
  const oldest =
    Math.floor(Date.now() / tier.bucketMs) * tier.bucketMs - (tier.retention - 1) * tier.bucketMs;
  for (const row of rows) {
    if (!Array.isArray(row) || (row.length !== 3 && row.length !== 4)) continue;
    const [key, sum, count, max] = row as number[];
    if (![key, sum, count].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
    if (count <= 0 || key < oldest) continue;
    buckets.set(key, {
      sum,
      count,
      max: typeof max === 'number' && Number.isFinite(max) ? max : sum / count
    });
  }
}

// Pure: the store as written now, from whatever version was read.
export function migrateStore(parsed: unknown): StoreV3 | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const store = parsed as { v?: unknown };
  if (store.v === 3) {
    const v3 = parsed as Partial<StoreV3>;
    return { v: 3, hour: v3.hour ?? {}, quarter: v3.quarter ?? {} };
  }
  if (store.v === 1 || store.v === 2) {
    const legacy = parsed as LegacyStore;
    const hour: SerializedTier = {};
    for (const [field, metric] of Object.entries(LEGACY_FIELDS) as [
      keyof typeof LEGACY_FIELDS,
      HistoryMetric
    ][]) {
      const rows = legacy[field];
      if (Array.isArray(rows)) hour[metric] = rows as SerializedBucket[];
    }
    // The 15-minute tier starts empty; it fills within the day.
    return { v: 3, hour, quarter: {} };
  }
  return null;
}

function ensureLoaded(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const store = migrateStore(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')));
    if (!store) return;
    for (const metric of HISTORY_METRICS) {
      hydrate(state.hour.buckets[metric], store.hour[metric], state.hour);
      hydrate(state.quarter.buckets[metric], store.quarter[metric], state.quarter);
    }
  } catch {
    // Missing (first run) or unreadable: start empty.
  }
}

function buildPayload(): StoreV3 {
  return { v: STORE_VERSION, hour: serializeTier(state.hour), quarter: serializeTier(state.quarter) };
}

async function writeStore(): Promise<void> {
  if (state.writing) return;
  state.writing = true;
  state.lastSaveAt = Date.now();
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    // Write to a temp file and rename so no half-written file remains.
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(buildPayload()), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // Not fatal; retried on the next save.
  } finally {
    state.writing = false;
  }
}

function scheduleSave(): void {
  if (state.saveTimer) return;
  const delay = Math.max(0, SAVE_INTERVAL_MS - (Date.now() - state.lastSaveAt));
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    void writeStore();
  }, delay);
  if (typeof state.saveTimer.unref === 'function') state.saveTimer.unref();
}

// On a shutdown signal, write the final state synchronously once more.
function flushSync(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(buildPayload()), 'utf-8');
  } catch {
    // Swallow failures during shutdown.
  }
}

function hookExit(): void {
  if (state.exitHooked) return;
  state.exitHooked = true;
  process.once('SIGTERM', () => flushSync());
  process.once('SIGINT', () => flushSync());
  process.once('beforeExit', () => flushSync());
}

// --- Recording -------------------------------------------------------------

export function recordSample(cpuUsage: number, load1: number, at: number = Date.now()): void {
  ensureLoaded();
  hookExit();
  recordBoth('cpu', cpuUsage, at);
  recordBoth('load', load1, at);
  state.recentLoad.push({ at, value: load1 });
  pruneRecent(at);
  scheduleSave();
}

// The other metrics for this tick. Nulls (unavailable sources) are skipped so
// a bucket only ever averages real readings.
export function recordTrend(
  samples: Partial<Record<TrendKey, number | null>>,
  at: number = Date.now()
): void {
  ensureLoaded();
  hookExit();
  for (const metric of HISTORY_METRICS) {
    if (metric === 'cpu' || metric === 'load') continue;
    const value = samples[metric];
    if (typeof value === 'number' && Number.isFinite(value)) recordBoth(metric, value, at);
  }
  scheduleSave();
}

// --- Reading ---------------------------------------------------------------

export type Stat = 'avg' | 'max';

const valueOf = (bucket: Bucket | undefined, stat: Stat, digits: number) =>
  bucket ? round(stat === 'max' ? bucket.max : bucket.sum / bucket.count, digits) : null;

function tierFor(stepMs: number): Tier {
  return stepMs === QUARTER_MS ? state.quarter : state.hour;
}

function series(
  tier: Tier,
  metric: HistoryMetric,
  count: number,
  now: number,
  digits: number
): TrendSample[] {
  const newestKey = Math.floor(now / tier.bucketMs) * tier.bucketMs;
  return Array.from({ length: count }, (_, index) => {
    const key = newestKey - (count - 1 - index) * tier.bucketMs;
    return { at: new Date(key).toISOString(), value: valueOf(tier.buckets[metric].get(key), 'avg', digits) };
  });
}

export function getHistory(now: number = Date.now()): HistoryInfo {
  ensureLoaded();
  const hour = state.hour;
  const load: LoadSample[] = series(hour, 'load', LOAD_DISPLAY, now, 2).map(({ at, value }) => ({
    at,
    avg1: value
  }));
  const cpuHourly: CpuHourSample[] = series(hour, 'cpu', CPU_DISPLAY, now, 1).map(({ at, value }) => ({
    at,
    usage: value
  }));
  const trends = {
    mem: series(hour, 'mem', CPU_DISPLAY, now, 1),
    disk: series(hour, 'disk', CPU_DISPLAY, now, 1),
    temp: series(hour, 'temp', CPU_DISPLAY, now, 1),
    net: series(hour, 'net', CPU_DISPLAY, now, 1)
  };
  return { load, cpuHourly, trends };
}

// The last `count` buckets of one metric at the given step (hourly or 15-min),
// oldest first. Capped at that tier's retention.
export function getSeries(
  metric: HistoryMetric,
  stepMs: number,
  count: number,
  now: number = Date.now()
): TrendSample[] {
  ensureLoaded();
  const tier = tierFor(stepMs);
  return series(tier, metric, Math.min(count, tier.retention), now, 2);
}

export function getHourlySeries(
  metric: HistoryMetric,
  hours: number,
  now: number = Date.now()
): TrendSample[] {
  return getSeries(metric, HOUR_MS, hours, now);
}

// Bucket values for [from, to) at the given step (from floored to a bucket),
// oldest first — for comparing two calendar periods. Capped at the retention.
export function getRange(
  metric: HistoryMetric,
  from: number,
  to: number,
  stepMs: number = HOUR_MS,
  stat: Stat = 'avg'
): (number | null)[] {
  ensureLoaded();
  const tier = tierFor(stepMs);
  const start = Math.floor(from / tier.bucketMs) * tier.bucketMs;
  const count = Math.min(tier.retention, Math.max(0, Math.ceil((to - start) / tier.bucketMs)));
  return Array.from({ length: count }, (_, index) =>
    valueOf(tier.buckets[metric].get(start + index * tier.bucketMs), stat, 2)
  );
}

export function getHourlyRange(metric: HistoryMetric, from: number, to: number): (number | null)[] {
  return getRange(metric, from, to, HOUR_MS);
}

// The oldest time each tier still covers, so callers can pick the finest one.
export function quarterCoversFrom(now: number = Date.now()): number {
  return Math.floor(now / QUARTER_MS) * QUARTER_MS - (QUARTER_RETENTION - 1) * QUARTER_MS;
}
