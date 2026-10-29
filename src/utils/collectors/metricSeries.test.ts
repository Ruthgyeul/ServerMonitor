import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, vi } from 'vitest';

async function fresh() {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'series-test-'));
  process.env.DATA_DIR = dir;
  process.env.HISTORY_FILE = join(dir, 'history.json');
  return import('@/utils/collectors/metricSeries');
}

const MINUTE = 60_000;

describe('getMetricSeries', () => {
  it('averages samples into one-minute points for the 1h range', async () => {
    const { recordMinuteSample, getMetricSeries } = await fresh();
    const now = Date.UTC(2026, 9, 29, 12, 30, 30);
    recordMinuteSample({ cpu: 10, down: 4 }, now - 20_000);
    recordMinuteSample({ cpu: 30, down: 6 }, now);
    recordMinuteSample({ cpu: 50 }, now - 5 * MINUTE);

    const series = getMetricSeries('1h', now);
    expect(series.stepSeconds).toBe(60);
    expect(series.points).toHaveLength(60);
    const last = series.points.at(-1)!;
    expect(last.at).toBe(new Date(Date.UTC(2026, 9, 29, 12, 30)).toISOString());
    expect(last.cpu).toBe(20);
    expect(last.down).toBe(5);
    expect(last.mem).toBeNull();
    expect(series.points.at(-6)!.cpu).toBe(50);
  });

  it('folds minutes into five-minute points for the 6h range', async () => {
    const { recordMinuteSample, getMetricSeries } = await fresh();
    const now = Date.UTC(2026, 9, 29, 12, 4, 0);
    recordMinuteSample({ mem: 10 }, Date.UTC(2026, 9, 29, 12, 0, 0));
    recordMinuteSample({ mem: 30 }, Date.UTC(2026, 9, 29, 12, 3, 0));

    const series = getMetricSeries('6h', now);
    expect(series.points).toHaveLength(72);
    expect(series.points.at(-1)!.mem).toBe(20);
  });

  it('reads the long ranges from the hourly history', async () => {
    const { getMetricSeries } = await fresh();
    const { recordSample, recordTrend } = await import('@/utils/collectors/history');
    const now = Date.UTC(2026, 9, 29, 12, 10, 0);
    recordSample(40, 1, now);
    recordTrend({ mem: 25, disk: 60, down: 3, up: 1 }, now);

    const day = getMetricSeries('24h', now);
    expect(day.points).toHaveLength(24);
    expect(day.points.at(-1)).toMatchObject({ cpu: 40, mem: 25, disk: 60, down: 3, up: 1 });
    expect(getMetricSeries('7d', now).points).toHaveLength(168);
  });
});
