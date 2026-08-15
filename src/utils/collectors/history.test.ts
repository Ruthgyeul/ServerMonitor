import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// history holds its buckets in module scope, so it must be reimported per test.
// The store file is also given a per-test temp directory so they don't interfere.
async function freshHistory() {
  vi.resetModules();
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
    const keys = saved.loadBuckets.map((row: [number, number, number]) => row[0]);
    // The bucket from 100 hours ago must remain on disk (not pruned).
    expect(keys).toContain(now - 100 * HOUR);
    // The graph still draws only 48 cells — old data is retained but not displayed.
    expect(first.getHistory(now).load).toHaveLength(48);
  });

  it('drops buckets older than 7 days', async () => {
    const first = await freshHistory();
    const now = Math.floor(Date.now() / HOUR) * HOUR;

    first.recordSample(0, 9, now - 200 * HOUR); // outside 7 days (168h)
    first.recordSample(0, 1, now);

    process.emit('SIGTERM');
    const saved = JSON.parse(readFileSync(first.file, 'utf-8'));
    const keys = saved.loadBuckets.map((row: [number, number, number]) => row[0]);
    expect(keys).not.toContain(now - 200 * HOUR);
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
    expect(saved.loadBuckets.length).toBeGreaterThan(0);

    // A new module instance pointing at the same file must re-read the values.
    vi.resetModules();
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
