import fs from 'fs';
import path from 'path';

import { round } from '@/utils/collectors/shell';

// Tracks daily network totals (download + upload bytes) so an operator with an
// ISP data cap can see monthly usage — the instantaneous rate and the 24h
// trend elsewhere don't answer "how much have I used this month". Derived
// from the same cumulative interface counters (network.totalRxBytes/
// totalTxBytes) already read every tick; this only accumulates their deltas
// into daily buckets.
//
// Persisted separately from history.ts, whose hourly buckets store an AVERAGE
// (sum/count) rather than a running total — wrong shape for "bytes used this
// day". Same atomic-write pattern (tmp file + rename) as history.ts/alerts.ts.

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.BANDWIDTH_FILE || path.join(DATA_DIR, 'bandwidth.json');
const STORE_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
// How long daily totals are kept. 90 days covers three monthly billing cycles.
const RETENTION_DAYS = 90;

interface DayTotal {
  rx: number;
  tx: number;
}

const days = new Map<number, DayTotal>(); // key: UTC day start, ms since epoch

// The last cumulative counters seen (and when), so a sample only ever
// records the delta since the previous tick (never the running total
// itself), and so that delta can be split across a UTC day boundary.
let prevCumulative: { rx: number; tx: number; at: number } | null = null;

function dayKey(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS;
}

function prune(oldestKey: number): void {
  for (const key of days.keys()) {
    if (key < oldestKey) days.delete(key);
  }
}

function addToDay(key: number, rx: number, tx: number): void {
  if (rx <= 0 && tx <= 0) return;
  const bucket = days.get(key) ?? { rx: 0, tx: 0 };
  bucket.rx += rx;
  bucket.tx += tx;
  days.set(key, bucket);
}

// Splits a delta across every UTC day the [prevAt, at] interval touches,
// assuming a uniform transfer rate over that interval. Ticks are ~1s apart
// in normal operation, so this only matters right at midnight or after a
// long gap (restart). Without it, the whole tick's delta lands on
// dayKey(at), silently moving traffic from the day it was actually
// transferred on.
function recordDelta(prevAt: number, at: number, deltaRx: number, deltaTx: number): void {
  const prevKey = dayKey(prevAt);
  const currentKey = dayKey(at);
  const totalElapsed = at - prevAt;
  if (prevKey === currentKey || totalElapsed <= 0) {
    addToDay(currentKey, deltaRx, deltaTx);
    return;
  }

  let cursor = prevAt;
  for (let key = prevKey; key <= currentKey; key += DAY_MS) {
    const segmentEnd = key === currentKey ? at : Math.min(at, key + DAY_MS);
    const fraction = (segmentEnd - cursor) / totalElapsed;
    if (fraction > 0) addToDay(key, deltaRx * fraction, deltaTx * fraction);
    cursor = segmentEnd;
  }
}

// --- Persistence -----------------------------------------------------------

type SerializedDay = [key: number, rx: number, tx: number];
interface StoreShape {
  v: number;
  days: SerializedDay[];
  prevCumulative: { rx: number; tx: number; at: number } | null;
}

let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed && parsed.v === STORE_VERSION) {
      if (Array.isArray(parsed.days)) {
        for (const row of parsed.days) {
          if (!Array.isArray(row) || row.length !== 3) continue;
          const [key, rx, tx] = row;
          if (typeof key !== 'number' || typeof rx !== 'number' || typeof tx !== 'number') continue;
          days.set(key, { rx, tx });
        }
      }
      // Restoring the last cumulative counters avoids double-counting (or
      // undercounting) the bytes transferred between the last save and this
      // restart — without it, the first tick after a restart would either be
      // skipped (no prior reading) or, worse, mistaken for a huge negative
      // delta if a stale value were reused.
      if (
        parsed.prevCumulative &&
        typeof parsed.prevCumulative.rx === 'number' &&
        typeof parsed.prevCumulative.tx === 'number'
      ) {
        // Older store files predate the `at` field. Falling back to "now"
        // means the very first post-restart delta is attributed to today
        // rather than split against an unknown past day — the same
        // single-day behavior this store had before the fix.
        const at = typeof parsed.prevCumulative.at === 'number' ? parsed.prevCumulative.at : Date.now();
        prevCumulative = { rx: parsed.prevCumulative.rx, tx: parsed.prevCumulative.tx, at };
      }
    }
  } catch {
    // If the file is missing (first run) or unreadable, start empty.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
const SAVE_INTERVAL_MS = 30 * 1000;

function buildPayload(): StoreShape {
  return {
    v: STORE_VERSION,
    days: [...days.entries()].map(([key, { rx, tx }]) => [key, rx, tx]),
    prevCumulative
  };
}

async function writeStore(): Promise<void> {
  if (writing) return;
  writing = true;
  const payload = buildPayload();
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // A disk write failure is not fatal. Retry on the next save.
  } finally {
    writing = false;
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeStore();
  }, SAVE_INTERVAL_MS);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

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

// --- Public API --------------------------------------------------------

// Called once per systemMonitor tick with the CUMULATIVE (since-boot) rx/tx
// byte counters already read for the network card.
export function recordBandwidthSample(
  cumulativeRx: number,
  cumulativeTx: number,
  at: number = Date.now()
): void {
  ensureLoaded();
  hookExit();

  if (prevCumulative) {
    // A counter reset (reboot, interface swap) makes the raw delta negative;
    // clamp to 0 for that one tick rather than subtracting a huge number.
    const deltaRx = Math.max(0, cumulativeRx - prevCumulative.rx);
    const deltaTx = Math.max(0, cumulativeTx - prevCumulative.tx);
    if (deltaRx > 0 || deltaTx > 0) {
      recordDelta(prevCumulative.at, at, deltaRx, deltaTx);
      prune(dayKey(at) - (RETENTION_DAYS - 1) * DAY_MS);
      scheduleSave();
    }
  }
  prevCumulative = { rx: cumulativeRx, tx: cumulativeTx, at };
}

export interface DailyBandwidth {
  date: string; // YYYY-MM-DD, UTC
  downloadMB: number;
  uploadMB: number;
}

// The last `count` days, oldest first, zero-filled for days with no sample.
export function getBandwidthHistory(count: number = 30, at: number = Date.now()): DailyBandwidth[] {
  ensureLoaded();
  const todayKey = dayKey(at);
  return Array.from({ length: count }, (_, index) => {
    const key = todayKey - (count - 1 - index) * DAY_MS;
    const bucket = days.get(key);
    return {
      date: new Date(key).toISOString().slice(0, 10),
      downloadMB: bucket ? round(bucket.rx / (1024 * 1024)) : 0,
      uploadMB: bucket ? round(bucket.tx / (1024 * 1024)) : 0
    };
  });
}
