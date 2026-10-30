import fs from 'fs';
import path from 'path';

import { round } from '@/utils/collectors/shell';
import { processSingleton } from '@/utils/processSingleton';

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
//
// Days run from local midnight (the server's TZ), so "today" on the chart is
// the operator's day. v1 stores used UTC days; their keys are moved to the
// local day with the same date when loaded.

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.BANDWIDTH_FILE || path.join(DATA_DIR, 'bandwidth.json');
const STORE_VERSION = 2;

// How long daily totals are kept. 90 days covers three monthly billing cycles.
const RETENTION_DAYS = 90;

interface DayTotal {
  rx: number;
  tx: number;
}

// Shared by every bundle in the process (see processSingleton). `days` is keyed
// by local day start (ms since epoch). `prevCumulative` holds the last
// cumulative counters seen (and when), so a sample only ever records the delta
// since the previous tick and that delta can be split across a day boundary.
const state = processSingleton('bandwidth', () => ({
  days: new Map<number, DayTotal>(),
  prevCumulative: null as { rx: number; tx: number; at: number } | null,
  loaded: false,
  saveTimer: null as ReturnType<typeof setTimeout> | null,
  writing: false,
  exitHooked: false
}));
const { days } = state;

// Pure: the local midnight starting the day that contains `at`.
export function dayKey(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// Pure: the local midnight `offset` days after the day starting at `key`
// (days are 23–25 hours long around DST changes, so this isn't key + 24h).
export function shiftDay(key: number, offset: number): number {
  const date = new Date(key);
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// Pure: a v1 key (UTC midnight) → the local day with the same calendar date.
export function utcKeyToLocal(key: number): number {
  const utc = new Date(key);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()).getTime();
}

function localDate(key: number): string {
  const date = new Date(key);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

// Splits a delta across every local day the [prevAt, at] interval touches,
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
  for (let key = prevKey; key <= currentKey; key = shiftDay(key, 1)) {
    const segmentEnd = key === currentKey ? at : Math.min(at, shiftDay(key, 1));
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

function ensureLoaded(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed && (parsed.v === STORE_VERSION || parsed.v === 1)) {
      if (Array.isArray(parsed.days)) {
        for (const row of parsed.days) {
          if (!Array.isArray(row) || row.length !== 3) continue;
          const [key, rx, tx] = row;
          if (typeof key !== 'number' || typeof rx !== 'number' || typeof tx !== 'number') continue;
          days.set(parsed.v === 1 ? utcKeyToLocal(key) : key, { rx, tx });
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
        state.prevCumulative = { rx: parsed.prevCumulative.rx, tx: parsed.prevCumulative.tx, at };
      }
    }
  } catch {
    // If the file is missing (first run) or unreadable, start empty.
  }
}

const SAVE_INTERVAL_MS = 30 * 1000;

function buildPayload(): StoreShape {
  return {
    v: STORE_VERSION,
    days: [...days.entries()].map(([key, { rx, tx }]) => [key, rx, tx]),
    prevCumulative: state.prevCumulative
  };
}

async function writeStore(): Promise<void> {
  if (state.writing) return;
  state.writing = true;
  const payload = buildPayload();
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // A disk write failure is not fatal. Retry on the next save.
  } finally {
    state.writing = false;
  }
}

function scheduleSave(): void {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    void writeStore();
  }, SAVE_INTERVAL_MS);
  if (typeof state.saveTimer.unref === 'function') state.saveTimer.unref();
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

function hookExit(): void {
  if (state.exitHooked) return;
  state.exitHooked = true;
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

  const prev = state.prevCumulative;
  if (prev) {
    // A counter reset (reboot, interface swap) makes the raw delta negative;
    // clamp to 0 for that one tick rather than subtracting a huge number.
    const deltaRx = Math.max(0, cumulativeRx - prev.rx);
    const deltaTx = Math.max(0, cumulativeTx - prev.tx);
    if (deltaRx > 0 || deltaTx > 0) {
      recordDelta(prev.at, at, deltaRx, deltaTx);
      prune(shiftDay(dayKey(at), -(RETENTION_DAYS - 1)));
      scheduleSave();
    }
  }
  state.prevCumulative = { rx: cumulativeRx, tx: cumulativeTx, at };
}

export interface DailyBandwidth {
  date: string; // YYYY-MM-DD, server-local
  downloadMB: number;
  uploadMB: number;
}

// The last `count` days, oldest first, zero-filled for days with no sample.
export function getBandwidthHistory(count: number = 30, at: number = Date.now()): DailyBandwidth[] {
  ensureLoaded();
  const todayKey = dayKey(at);
  return Array.from({ length: count }, (_, index) => {
    const key = shiftDay(todayKey, -(count - 1 - index));
    const bucket = days.get(key);
    return {
      date: localDate(key),
      downloadMB: bucket ? round(bucket.rx / (1024 * 1024)) : 0,
      uploadMB: bucket ? round(bucket.tx / (1024 * 1024)) : 0
    };
  });
}
