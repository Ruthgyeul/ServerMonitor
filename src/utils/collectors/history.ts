import fs from 'fs';
import path from 'path';

import { CpuHourSample, HistoryInfo, LoadSample } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// History buckets live in process memory but are also persisted to disk, so a
// restart after a deploy (git pull) or a crash doesn't reset the graphs. The
// store file lives in the gitignored data directory, so pull/build don't touch
// it.
//
// Retention and display are separated. Buckets keep 7 days at 1-hour
// granularity (168 cells) — the window for pruning/disk recovery — but the
// graphs still draw only 48h of load and 24h of CPU as before. getHistory slices
// to just the display window, so the screen doesn't change even as 7 days of
// data accumulate.
const LOAD_BUCKET_MS = 60 * 60 * 1000;
const HOUR_BUCKET_MS = 60 * 60 * 1000;

// The retention (prune / disk recovery) window — both buckets keep 7 days.
const RETENTION_HOURS = 7 * 24;
const LOAD_RETENTION = RETENTION_HOURS;
const CPU_RETENTION = RETENTION_HOURS;

// The window actually drawn on the graphs — unchanged from before.
const LOAD_DISPLAY = 48; // 48 hours
const CPU_DISPLAY = 24; // 24 hours

// A minimum save interval keeps disk writes from being too frequent. The
// buckets are small (a few dozen), so the worst-case data loss is just this interval.
const SAVE_INTERVAL_MS = 30 * 1000;

// process.cwd() resolves to the project root at runtime; without this ignore,
// Turbopack's file tracer can't statically scope it and traces the entire
// project into the output bundle (the "unexpected file in NFT list" warning).
const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.HISTORY_FILE || path.join(DATA_DIR, 'history.json');
// v2 adds the per-metric trend buckets. A v1 file still loads (its trend series
// just start empty and fill over time).
const STORE_VERSION = 2;
const SUPPORTED_VERSIONS = new Set([1, 2]);

interface Bucket {
  sum: number;
  count: number;
}

const loadBuckets = new Map<number, Bucket>();
const cpuBuckets = new Map<number, Bucket>();

// Per-metric trend buckets (memory %, disk %, temperature °C, network KB/s).
// Same hourly granularity/retention as CPU; drawn as 24h sparklines per card.
// Kept in one record so the persistence/serialisation loops stay generic.
const TREND_KEYS = ['mem', 'disk', 'temp', 'net'] as const;
type TrendKey = (typeof TREND_KEYS)[number];
const trendBuckets: Record<TrendKey, Map<number, Bucket>> = {
  mem: new Map(),
  disk: new Map(),
  temp: new Map(),
  net: new Map()
};

// --- 30-minute moving average --------------------------------------------
// The kernel only gives 1/5/15-minute load averages, so we compute the 30-minute
// one ourselves by keeping each sample in a short window. At a 1s interval (15s
// when idle) the window holds at most 1800 entries — no memory burden — and,
// unlike the buckets, it isn't persisted (it refills after a restart).
const ROLLING_WINDOW_MS = 30 * 60 * 1000;

interface Sample {
  at: number;
  value: number;
}

const recentLoad: Sample[] = [];

export interface RollingAverage {
  value: number | null;
  // The span actually covered (seconds). The caller must be able to tell if the
  // window is only partly filled. Reporting minutes would read "0-minute average"
  // right after start, so it's given in seconds.
  windowSeconds: number;
}

// Trim samples that fell out of the window from the front. They arrive in time order, so only the front needs checking.
function pruneRecent(now: number): void {
  const oldest = now - ROLLING_WINDOW_MS;
  let drop = 0;
  while (drop < recentLoad.length && recentLoad[drop].at < oldest) drop += 1;
  if (drop > 0) recentLoad.splice(0, drop);
}

export function getLoad30mAverage(now: number = Date.now()): RollingAverage {
  pruneRecent(now);
  if (recentLoad.length === 0) return { value: null, windowSeconds: 0 };

  const sum = recentLoad.reduce((total, sample) => total + sample.value, 0);
  const spanMs = now - recentLoad[0].at;
  return {
    value: round(sum / recentLoad.length, 2),
    windowSeconds: Math.min(ROLLING_WINDOW_MS / 1000, Math.round(spanMs / 1000))
  };
}

function add(buckets: Map<number, Bucket>, key: number, value: number): void {
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.sum += value;
    bucket.count += 1;
  } else {
    buckets.set(key, { sum: value, count: 1 });
  }
}

function prune(buckets: Map<number, Bucket>, oldestKey: number): void {
  for (const key of buckets.keys()) {
    if (key < oldestKey) buckets.delete(key);
  }
}

// --- Persistence ---------------------------------------------------------

type SerializedBucket = [key: number, sum: number, count: number];
interface StoreShape {
  v: number;
  loadBuckets: SerializedBucket[];
  cpuBuckets: SerializedBucket[];
  // Added in store v2 (optional so a v1 file still loads its load/cpu history).
  memBuckets?: SerializedBucket[];
  diskBuckets?: SerializedBucket[];
  tempBuckets?: SerializedBucket[];
  netBuckets?: SerializedBucket[];
}

function serialize(buckets: Map<number, Bucket>): SerializedBucket[] {
  return [...buckets.entries()].map(([key, { sum, count }]) => [key, sum, count]);
}

function hydrate(buckets: Map<number, Bucket>, rows: unknown, bucketMs: number, count: number): void {
  if (!Array.isArray(rows)) return;
  const oldest = Math.floor(Date.now() / bucketMs) * bucketMs - (count - 1) * bucketMs;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) continue;
    const [key, sum, cnt] = row;
    // Silently drop corrupt/stale buckets. They just show as "no data" on screen.
    if (typeof key !== 'number' || typeof sum !== 'number' || typeof cnt !== 'number') continue;
    if (!Number.isFinite(key) || cnt <= 0 || key < oldest) continue;
    buckets.set(key, { sum, count: cnt });
  }
}

let loaded = false;

// Read from disk once on first access. Uses a synchronous read to avoid a
// top-level await (the file is small, so it's fine).
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed && SUPPORTED_VERSIONS.has(parsed.v)) {
      hydrate(loadBuckets, parsed.loadBuckets, LOAD_BUCKET_MS, LOAD_RETENTION);
      hydrate(cpuBuckets, parsed.cpuBuckets, HOUR_BUCKET_MS, CPU_RETENTION);
      // v1 files simply have these undefined; hydrate no-ops on a non-array.
      hydrate(trendBuckets.mem, parsed.memBuckets, HOUR_BUCKET_MS, CPU_RETENTION);
      hydrate(trendBuckets.disk, parsed.diskBuckets, HOUR_BUCKET_MS, CPU_RETENTION);
      hydrate(trendBuckets.temp, parsed.tempBuckets, HOUR_BUCKET_MS, CPU_RETENTION);
      hydrate(trendBuckets.net, parsed.netBuckets, HOUR_BUCKET_MS, CPU_RETENTION);
    }
  } catch {
    // If the file is missing (first run) or unreadable, start empty.
  }
}

let lastSaveAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;

function buildPayload(): StoreShape {
  return {
    v: STORE_VERSION,
    loadBuckets: serialize(loadBuckets),
    cpuBuckets: serialize(cpuBuckets),
    memBuckets: serialize(trendBuckets.mem),
    diskBuckets: serialize(trendBuckets.disk),
    tempBuckets: serialize(trendBuckets.temp),
    netBuckets: serialize(trendBuckets.net)
  };
}

async function writeStore(): Promise<void> {
  if (writing) return;
  writing = true;
  lastSaveAt = Date.now();
  const payload = buildPayload();
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    // Write to a temp file and rename so no half-written file remains (atomic replace).
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // A disk write failure is not fatal. Retry on the next save.
  } finally {
    writing = false;
  }
}

// Rather than writing every sample, schedule with a minimum interval.
function scheduleSave(): void {
  if (saveTimer) return;
  const elapsed = Date.now() - lastSaveAt;
  const delay = Math.max(0, SAVE_INTERVAL_MS - elapsed);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeStore();
  }, delay);
  // Don't let this one timer keep the process from exiting.
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

// On a shutdown signal, write the final state synchronously once more. Even if
// the scheduled save hasn't run yet, the recent window isn't lost.
function flushSync(): void {
  try {
    const payload = buildPayload();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload), 'utf-8');
  } catch {
    // Swallow failures during shutdown.
  }
}

let exitHooked = false;
function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.once('SIGTERM', () => flushSync());
  process.once('SIGINT', () => flushSync());
  process.once('beforeExit', () => flushSync());
}

// --- Public API ----------------------------------------------------------

export function recordSample(cpuUsage: number, load1: number, at: number = Date.now()): void {
  ensureLoaded();
  hookExit();

  const loadKey = Math.floor(at / LOAD_BUCKET_MS) * LOAD_BUCKET_MS;
  const hourKey = Math.floor(at / HOUR_BUCKET_MS) * HOUR_BUCKET_MS;

  add(loadBuckets, loadKey, load1);
  add(cpuBuckets, hourKey, cpuUsage);

  recentLoad.push({ at, value: load1 });
  pruneRecent(at);

  prune(loadBuckets, loadKey - (LOAD_RETENTION - 1) * LOAD_BUCKET_MS);
  prune(cpuBuckets, hourKey - (CPU_RETENTION - 1) * HOUR_BUCKET_MS);

  scheduleSave();
}

// Record the per-metric trend samples for this tick. Nulls (unavailable/N/A
// sources) are skipped so a bucket only ever averages real readings.
export function recordTrend(
  samples: { mem?: number | null; disk?: number | null; temp?: number | null; net?: number | null },
  at: number = Date.now()
): void {
  ensureLoaded();
  hookExit();

  const hourKey = Math.floor(at / HOUR_BUCKET_MS) * HOUR_BUCKET_MS;
  const oldest = hourKey - (CPU_RETENTION - 1) * HOUR_BUCKET_MS;
  for (const key of TREND_KEYS) {
    const value = samples[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      add(trendBuckets[key], hourKey, value);
      prune(trendBuckets[key], oldest);
    }
  }
  scheduleSave();
}

function series(buckets: Map<number, Bucket>, bucketMs: number, count: number, now: number, digits: number) {
  const newestKey = Math.floor(now / bucketMs) * bucketMs;
  return Array.from({ length: count }, (_, index) => {
    const key = newestKey - (count - 1 - index) * bucketMs;
    const bucket = buckets.get(key);
    return {
      at: new Date(key).toISOString(),
      value: bucket ? round(bucket.sum / bucket.count, digits) : null
    };
  });
}

export function getHistory(now: number = Date.now()): HistoryInfo {
  ensureLoaded();
  const load: LoadSample[] = series(loadBuckets, LOAD_BUCKET_MS, LOAD_DISPLAY, now, 2).map(
    ({ at, value }) => ({ at, avg1: value })
  );
  const cpuHourly: CpuHourSample[] = series(cpuBuckets, HOUR_BUCKET_MS, CPU_DISPLAY, now, 1).map(
    ({ at, value }) => ({ at, usage: value })
  );
  const trends = {
    mem: series(trendBuckets.mem, HOUR_BUCKET_MS, CPU_DISPLAY, now, 1),
    disk: series(trendBuckets.disk, HOUR_BUCKET_MS, CPU_DISPLAY, now, 1),
    temp: series(trendBuckets.temp, HOUR_BUCKET_MS, CPU_DISPLAY, now, 1),
    net: series(trendBuckets.net, HOUR_BUCKET_MS, CPU_DISPLAY, now, 1)
  };
  return { load, cpuHourly, trends };
}
