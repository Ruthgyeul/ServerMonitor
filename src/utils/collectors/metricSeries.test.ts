import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, vi } from 'vitest';

import { resetProcessSingletons } from '@/utils/processSingleton';

async function fresh(dir = mkdtempSync(join(tmpdir(), 'series-test-'))) {
  vi.resetModules();
  resetProcessSingletons();
  process.env.DATA_DIR = dir;
  process.env.HISTORY_FILE = join(dir, 'history.json');
  process.env.MINUTES_FILE = join(dir, 'minutes.json');
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

  it('reads 24h from the 15-minute tier and 7d from the hourly tier', async () => {
    const { getMetricSeries } = await fresh();
    const { recordSample, recordTrend } = await import('@/utils/collectors/history');
    const now = Date.UTC(2026, 9, 29, 12, 10, 0);
    recordSample(40, 1, now);
    recordTrend({ mem: 25, disk: 60, down: 3, up: 1, swap: 5, temp: 48 }, now);

    const day = getMetricSeries('24h', now);
    expect(day.stepSeconds).toBe(900);
    expect(day.points).toHaveLength(96);
    expect(day.points.at(-1)).toMatchObject({
      cpu: 40,
      mem: 25,
      disk: 60,
      down: 3,
      up: 1,
      load: 1,
      swap: 5,
      temp: 48
    });
    const week = getMetricSeries('7d', now);
    expect(week.points).toHaveLength(168);
    expect(week.points.at(-1)).toMatchObject({ cpu: 40, diskRead: null });
  });

  it('keeps minute buckets across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'series-test-'));
    const first = await fresh(dir);
    const now = Math.floor(Date.now() / MINUTE) * MINUTE;
    first.recordMinuteSample({ cpu: 33, diskRead: 120 }, now);
    process.emit('SIGTERM');
    expect(JSON.parse(readFileSync(join(dir, 'minutes.json'), 'utf-8')).v).toBe(1);

    const second = await fresh(dir);
    expect(second.getMetricSeries('1h', now).points.at(-1)).toMatchObject({ cpu: 33, diskRead: 120 });
  });
});

describe('getMetricWindow', () => {
  it('uses minutes for recent windows and sums net from down and up', async () => {
    const { recordMinuteSample, getMetricWindow } = await fresh();
    const now = Date.UTC(2026, 9, 29, 12, 30, 0);
    recordMinuteSample({ cpu: 80, down: 3, up: 2 }, now - 10 * MINUTE);
    const window = getMetricWindow('cpu', now - 30 * MINUTE, now, now);
    expect(window.stepSeconds).toBe(60);
    expect(window.points).toHaveLength(30);
    expect(window.points[20].value).toBe(80);
    expect(getMetricWindow('net', now - 30 * MINUTE, now, now).points[20].value).toBe(5);
  });

  it('falls back to the 15-minute tier for older windows', async () => {
    const { getMetricWindow } = await fresh();
    const { recordTrend } = await import('@/utils/collectors/history');
    const now = Date.UTC(2026, 9, 29, 12, 0, 0);
    const old = now - 2 * 24 * 60 * MINUTE;
    recordTrend({ temp: 70 }, old + MINUTE);
    const window = getMetricWindow('temp', old, old + 60 * MINUTE, now);
    expect(window.stepSeconds).toBe(900);
    expect(window.points[0].value).toBe(70);
  });
});
