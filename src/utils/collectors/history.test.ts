import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetProcessSingletons } from '@/utils/processSingleton';

// history keeps its buckets in a process singleton (reset before each test by
// the test setup); the store file gets a per-test temp directory.
async function freshHistory() {
  vi.resetModules();
  resetProcessSingletons();
  const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
  process.env.DATA_DIR = dir;
  process.env.HISTORY_FILE = join(dir, 'history.json');
  const loaded = await import('@/utils/collectors/history');
  return { ...loaded, dir, file: process.env.HISTORY_FILE };
}

const HOUR = 60 * 60 * 1000;

describe('load history buckets', () => {
  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.HISTORY_FILE;
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.HISTORY_FILE;
  });

  it('returns 48 hours as 48 one-hour buckets', async () => {
    const { recordSample, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(10, 1.5, now);
    const { load } = getHistory(now);

    expect(load).toHaveLength(48);
    // The oldest and newest cells must be exactly 47 hours apart to cover 48 hours.
    const span = new Date(load.at(-1)!.at).getTime() - new Date(load[0].at).getTime();
    expect(span).toBe(47 * HOUR);
  });

  it('samples in the same hour are merged into an average', async () => {
    const { recordSample, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 2, now);
    recordSample(0, 4, now + 60_000);

    expect(getHistory(now).load.at(-1)!.avg1).toBe(3);
  });

  it('leaves null for the stretch the server was down', async () => {
    const { recordSample, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 1, now - 3 * HOUR);
    recordSample(0, 1, now);

    const { load } = getHistory(now);
    // Only the newest cell and the cell 3 hours ago have values; the gap is empty.
    expect(load.at(-1)!.avg1).toBe(1);
    expect(load.at(-2)!.avg1).toBeNull();
    expect(load.at(-4)!.avg1).toBe(1);
  });

  it('retains data within 7 days even outside the display window (48h)', async () => {
    const first = await freshHistory();
    // prune trims relative to the last sample time, so align to the real clock.
    const now = Math.floor(Date.now() / HOUR) * HOUR;

    // Older than the 48-hour display window, but inside the 7-day retention window.
    first.recordSample(0, 7, now - 100 * HOUR);
    first.recordSample(0, 1, now);

    process.emit('SIGTERM');
    const saved = JSON.parse(readFileSync(first.file, 'utf-8'));
    const keys = saved.hour.load.map((row: number[]) => row[0]);
    // The bucket from 100 hours ago must remain on disk (not pruned).
    expect(keys).toContain(now - 100 * HOUR);
    // The graph still draws only 48 cells — old data is retained but not displayed.
    expect(first.getHistory(now).load).toHaveLength(48);
  });

  it('drops buckets older than 62 days', async () => {
    const first = await freshHistory();
    const now = Math.floor(Date.now() / HOUR) * HOUR;

    first.recordSample(0, 9, now - 1500 * HOUR); // outside 62 days (1488h)
    first.recordSample(0, 1, now);

    process.emit('SIGTERM');
    const saved = JSON.parse(readFileSync(first.file, 'utf-8'));
    const keys = saved.hour.load.map((row: number[]) => row[0]);
    expect(keys).not.toContain(now - 1500 * HOUR);
  });

  it('recovers from disk across a restart', async () => {
    const first = await freshHistory();
    // Recovery drops buckets old relative to the real clock. Using a fixed past
    // time would immediately judge the stored bucket as "outside 48 hours", so align to now.
    const now = Math.floor(Date.now() / HOUR) * HOUR;
    first.recordSample(0, 2.5, now);

    // Trigger the same synchronous save as the shutdown path instead of waiting for the scheduled save.
    process.emit('SIGTERM');
    const saved = JSON.parse(readFileSync(first.file, 'utf-8'));
    expect(saved.hour.load.length).toBeGreaterThan(0);

    // A new process (fresh module and singletons) pointing at the same file must re-read the values.
    vi.resetModules();
    resetProcessSingletons();
    process.env.DATA_DIR = first.dir;
    process.env.HISTORY_FILE = first.file;
    const second = await import('@/utils/collectors/history');
    expect(second.getHistory(now).load.at(-1)!.avg1).toBe(2.5);
  });

  it('ignores the whole store when the format version differs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
    const file = join(dir, 'history.json');
    writeFileSync(file, JSON.stringify({ v: 99, loadBuckets: [[0, 5, 1]], cpuBuckets: [] }));

    vi.resetModules();
    process.env.DATA_DIR = dir;
    process.env.HISTORY_FILE = file;
    const { getHistory } = await import('@/utils/collectors/history');

    const { load } = getHistory(Date.UTC(2026, 0, 2, 12, 0, 0));
    expect(load.every(sample => sample.avg1 === null)).toBe(true);
  });

  it('starts empty without crashing on a corrupt file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
    const file = join(dir, 'history.json');
    writeFileSync(file, '{ this is not json');

    vi.resetModules();
    process.env.DATA_DIR = dir;
    process.env.HISTORY_FILE = file;
    const { getHistory } = await import('@/utils/collectors/history');

    expect(() => getHistory(Date.now())).not.toThrow();
  });
});

describe('trend history', () => {
  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.HISTORY_FILE;
  });

  it('records per-metric trends and averages within the hour', async () => {
    const { recordTrend, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordTrend({ mem: 40, disk: 50, temp: 55, net: 100 }, now);
    recordTrend({ mem: 60, disk: 50, temp: 55, net: 300 }, now + 60_000);

    const trends = getHistory(now).trends!;
    expect(trends.mem).toHaveLength(24);
    expect(trends.mem.at(-1)!.value).toBe(50); // (40+60)/2
    expect(trends.net.at(-1)!.value).toBe(200);
  });

  it('skips null samples so a bucket only averages real readings', async () => {
    const { recordTrend, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordTrend({ mem: 30, temp: null }, now); // temp N/A this tick
    expect(getHistory(now).trends!.temp.at(-1)!.value).toBeNull();
    expect(getHistory(now).trends!.mem.at(-1)!.value).toBe(30);
  });

  it('loads a v1 store (no trends) without error, trends starting empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
    const file = join(dir, 'history.json');
    const now = Math.floor(Date.now() / HOUR) * HOUR;
    writeFileSync(file, JSON.stringify({ v: 1, loadBuckets: [[now, 5, 1]], cpuBuckets: [[now, 20, 1]] }));

    vi.resetModules();
    process.env.DATA_DIR = dir;
    process.env.HISTORY_FILE = file;
    const { getHistory } = await import('@/utils/collectors/history');

    const history = getHistory(now);
    expect(history.load.at(-1)!.avg1).toBe(5); // v1 data still recovered
    expect(history.trends!.mem.every(sample => sample.value === null)).toBe(true);
  });
});

describe('getLoad30mAverage', () => {
  it('reports no value when there are no samples', async () => {
    const { getLoad30mAverage } = await freshHistory();
    expect(getLoad30mAverage(Date.now())).toEqual({ value: null, windowSeconds: 0 });
  });

  it('averages the samples inside the window', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 1, now - 60_000);
    recordSample(0, 3, now);

    expect(getLoad30mAverage(now).value).toBe(2);
  });

  it('reports the covered span in seconds when the window is not full', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 1, now - 90_000);
    recordSample(0, 1, now);

    // Rounding to minutes would read "0-minute average" right after start.
    expect(getLoad30mAverage(now).windowSeconds).toBe(90);
  });

  it('excludes samples older than 30 minutes from the average', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 100, now - 31 * 60_000);
    recordSample(0, 2, now);

    const rolling = getLoad30mAverage(now);
    expect(rolling.value).toBe(2);
    expect(rolling.windowSeconds).toBe(0);
  });

  it('caps the window length at 30 minutes', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    for (let minute = 30; minute >= 0; minute -= 1) {
      recordSample(0, 1, now - minute * 60_000);
    }

    expect(getLoad30mAverage(now).windowSeconds).toBe(30 * 60);
  });
});

describe('getHourlyRange', () => {
  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.HISTORY_FILE;
  });

  it('returns hourly averages for an arbitrary window, including load', async () => {
    const { recordSample, recordTrend, getHourlyRange } = await freshHistory();
    const day = Date.UTC(2026, 0, 2, 0, 0, 0);
    recordSample(10, 0.5, day + 30 * 60_000);
    recordSample(30, 1.5, day + 40 * 60_000);
    recordTrend({ mem: 50 }, day + 2 * HOUR + 1000);

    expect(getHourlyRange('cpu', day, day + 3 * HOUR)).toEqual([20, null, null]);
    expect(getHourlyRange('load', day, day + HOUR)).toEqual([1]);
    expect(getHourlyRange('mem', day, day + 3 * HOUR)).toEqual([null, null, 50]);
  });

  it('keeps history for 62 days', async () => {
    const { recordSample, getHourlyRange } = await freshHistory();
    const old = Date.UTC(2026, 0, 1, 0, 0, 0);
    recordSample(42, 1, old);
    recordSample(1, 1, old + 61 * 24 * HOUR);
    expect(getHourlyRange('cpu', old, old + HOUR)).toEqual([42]);
  });
});

describe('history store v3', () => {
  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.HISTORY_FILE;
  });

  it('keeps 15-minute buckets alongside hourly ones, with the max', async () => {
    const { recordSample, getRange, QUARTER_MS, HOUR_MS } = await freshHistory();
    const hour = Date.UTC(2026, 0, 2, 12, 0, 0);
    recordSample(10, 1, hour + 60_000);
    recordSample(50, 1, hour + 2 * 60_000);
    recordSample(30, 1, hour + 20 * 60_000);

    expect(getRange('cpu', hour, hour + 30 * 60_000, QUARTER_MS)).toEqual([30, 30]);
    expect(getRange('cpu', hour, hour + 30 * 60_000, QUARTER_MS, 'max')).toEqual([50, 30]);
    expect(getRange('cpu', hour, hour + HOUR_MS, HOUR_MS, 'max')).toEqual([50]);
  });

  it('records swap with the other trend metrics', async () => {
    const { recordTrend, getRange, HOUR_MS } = await freshHistory();
    const hour = Date.UTC(2026, 0, 2, 12, 0, 0);
    recordTrend({ swap: 12, temp: 50 }, hour + 1000);
    expect(getRange('swap', hour, hour + HOUR_MS)).toEqual([12]);
    expect(getRange('temp', hour, hour + HOUR_MS)).toEqual([50]);
  });

  it('migrates a v2 store into the hourly tier, using the average as max', async () => {
    const { migrateStore } = await freshHistory();
    expect(
      migrateStore({ v: 2, loadBuckets: [[1, 4, 2]], memBuckets: [[1, 30, 1]], netBuckets: 'bad' })
    ).toEqual({ v: 3, hour: { load: [[1, 4, 2]], mem: [[1, 30, 1]] }, quarter: {} });
    expect(migrateStore({ v: 99 })).toBeNull();
  });

  it('loads a v2 file and writes it back as v3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
    const file = join(dir, 'history.json');
    const now = Math.floor(Date.now() / HOUR) * HOUR;
    writeFileSync(file, JSON.stringify({ v: 2, loadBuckets: [], cpuBuckets: [[now, 40, 2]] }));

    vi.resetModules();
    resetProcessSingletons();
    process.env.DATA_DIR = dir;
    process.env.HISTORY_FILE = file;
    const history = await import('@/utils/collectors/history');
    expect(history.getRange('cpu', now, now + HOUR, HOUR, 'max')).toEqual([20]);

    history.recordSample(10, 1, now);
    process.emit('SIGTERM');
    const saved = JSON.parse(readFileSync(file, 'utf-8'));
    expect(saved.v).toBe(3);
    expect(saved.hour.cpu[0]).toEqual([now, 50, 3, 20]);
  });

  it('clamps HISTORY_RETENTION_DAYS', async () => {
    const { retentionDays } = await freshHistory();
    expect(retentionDays(undefined)).toBe(62);
    expect(retentionDays('90')).toBe(90);
    expect(retentionDays('1')).toBe(7);
    expect(retentionDays('5000')).toBe(400);
    expect(retentionDays('abc')).toBe(62);
  });
});
