import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// bandwidth.ts holds its daily buckets in module scope, so it must be
// reimported per test. Each test also gets its own temp store file so they
// don't interfere with each other.
async function freshBandwidth() {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'bandwidth-test-'));
  process.env.DATA_DIR = dir;
  process.env.BANDWIDTH_FILE = join(dir, 'bandwidth.json');
  return import('@/utils/collectors/bandwidth');
}

const MB = 1024 * 1024;

describe('bandwidth daily totals', () => {
  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.BANDWIDTH_FILE;
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.BANDWIDTH_FILE;
  });

  it('records nothing on the very first sample (no prior reading to diff against)', async () => {
    const { recordBandwidthSample, getBandwidthHistory } = await freshBandwidth();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordBandwidthSample(1000, 500, now);
    const history = getBandwidthHistory(1, now);

    expect(history).toHaveLength(1);
    expect(history[0].downloadMB).toBe(0);
    expect(history[0].uploadMB).toBe(0);
  });

  it('accumulates the delta between cumulative counters into the current day', async () => {
    const { recordBandwidthSample, getBandwidthHistory } = await freshBandwidth();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordBandwidthSample(0, 0, now);
    recordBandwidthSample(5 * MB, 2 * MB, now + 1000);
    recordBandwidthSample(8 * MB, 3 * MB, now + 2000);

    const history = getBandwidthHistory(1, now + 2000);
    expect(history[0].downloadMB).toBe(8);
    expect(history[0].uploadMB).toBe(3);
  });

  it('treats a counter reset (reboot) as a zero delta instead of a huge negative number', async () => {
    const { recordBandwidthSample, getBandwidthHistory } = await freshBandwidth();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordBandwidthSample(10 * MB, 10 * MB, now);
    // Counter dropped back to near-zero, as after a reboot.
    recordBandwidthSample(1 * MB, 1 * MB, now + 1000);
    // Then grows normally again.
    recordBandwidthSample(3 * MB, 2 * MB, now + 2000);

    const history = getBandwidthHistory(1, now + 2000);
    // Only the post-reset growth (1MB -> 3MB, 1MB -> 2MB) should count.
    expect(history[0].downloadMB).toBe(2);
    expect(history[0].uploadMB).toBe(1);
  });

  it('splits totals across day boundaries', async () => {
    const { recordBandwidthSample, getBandwidthHistory } = await freshBandwidth();
    const day1 = Date.UTC(2026, 0, 2, 23, 0, 0);
    const day2 = day1 + 2 * 60 * 60 * 1000; // 2 hours later, next UTC day

    recordBandwidthSample(0, 0, day1);
    recordBandwidthSample(4 * MB, 1 * MB, day1 + 1000); // still day 1
    recordBandwidthSample(10 * MB, 3 * MB, day2); // crosses into day 2

    const history = getBandwidthHistory(2, day2);
    expect(history[0].downloadMB).toBe(4); // day 1
    expect(history[1].downloadMB).toBe(6); // day 2 (10 - 4)
  });

  it('zero-fills days with no recorded sample', async () => {
    const { recordBandwidthSample, getBandwidthHistory } = await freshBandwidth();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordBandwidthSample(0, 0, now);
    recordBandwidthSample(1 * MB, 1 * MB, now + 1000);

    const history = getBandwidthHistory(5, now + 1000);
    expect(history).toHaveLength(5);
    expect(history.slice(0, 4).every(day => day.downloadMB === 0 && day.uploadMB === 0)).toBe(true);
    expect(history[4].downloadMB).toBe(1);
  });

  it('persists the running cumulative counter across a restart, so the first post-restart sample keeps diffing correctly', async () => {
    const first = await freshBandwidth();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    first.recordBandwidthSample(0, 0, now);
    first.recordBandwidthSample(2 * MB, 1 * MB, now + 1000);

    // Trigger the same synchronous save as the shutdown path instead of
    // waiting for the scheduled save (same technique as history.test.ts).
    process.emit('SIGTERM');
    const saved = JSON.parse(readFileSync(process.env.BANDWIDTH_FILE!, 'utf-8'));
    expect(saved.prevCumulative).toEqual({ rx: 2 * MB, tx: 1 * MB });

    // A new module instance pointing at the same file restores that counter,
    // so a sample right after "restart" still computes a correct delta
    // instead of treating the cumulative total itself as a delta.
    const dataDir = process.env.DATA_DIR!;
    const file = process.env.BANDWIDTH_FILE!;
    vi.resetModules();
    process.env.DATA_DIR = dataDir;
    process.env.BANDWIDTH_FILE = file;
    const second = await import('@/utils/collectors/bandwidth');

    second.recordBandwidthSample(5 * MB, 2 * MB, now + 2000);
    const history = second.getBandwidthHistory(1, now + 2000);
    // The day's total already had 2MB/1MB from before the "restart"; the new
    // sample adds its delta against the restored counter (5-2=3MB, 2-1=1MB)
    // on top of that, not against zero.
    expect(history[0].downloadMB).toBe(5);
    expect(history[0].uploadMB).toBe(2);
  });
});
