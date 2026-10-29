import { describe, expect, it } from 'vitest';

import {
  bucketDefs,
  delta,
  foldPoints,
  formatValue,
  periodWindow,
  stat
} from '@/components/compare/compareData';

describe('periodWindow', () => {
  it('uses local midnight for days', () => {
    const now = new Date(2026, 9, 29, 15, 30).getTime();
    const w = periodWindow('day', now);
    expect(new Date(w.start)).toEqual(new Date(2026, 9, 29));
    expect(new Date(w.prevStart)).toEqual(new Date(2026, 9, 28));
    expect(w.end - w.start).toBe(24 * 3_600_000);
  });

  it('starts weeks on Monday', () => {
    const thursday = new Date(2026, 9, 29, 9).getTime();
    const w = periodWindow('week', thursday);
    expect(new Date(w.start)).toEqual(new Date(2026, 9, 26)); // Monday
    expect(new Date(w.prevStart)).toEqual(new Date(2026, 9, 19));
    const sunday = new Date(2026, 10, 1, 9).getTime();
    expect(new Date(periodWindow('week', sunday).start)).toEqual(new Date(2026, 9, 26));
  });

  it('uses calendar months and daily points', () => {
    const w = periodWindow('month', new Date(2026, 2, 10).getTime());
    expect(new Date(w.start)).toEqual(new Date(2026, 2, 1));
    expect(new Date(w.prevStart)).toEqual(new Date(2026, 1, 1));
    expect(new Date(w.end)).toEqual(new Date(2026, 3, 1));
    expect(w.hoursPerPoint).toBe(24);
  });
});

describe('foldPoints', () => {
  it('averages groups and skips gaps', () => {
    expect(foldPoints([1, 3, null, null, 5], 2)).toEqual([2, null, 5]);
    expect(foldPoints([1, 2], 1)).toEqual([1, 2]);
  });
});

describe('stat', () => {
  it('computes average, 95th percentile and peak over known values', () => {
    const values = [null, ...Array.from({ length: 20 }, (_, i) => i + 1)];
    expect(stat(values, 'avg')).toBe(10.5);
    expect(stat(values, 'p95')).toBe(20);
    expect(stat(values, 'max')).toBe(20);
    expect(stat([null], 'avg')).toBeNull();
  });
});

describe('delta', () => {
  it('describes the relative change', () => {
    expect(delta(110, 100)).toEqual({ text: '+10.0%', tone: 'up' });
    expect(delta(90, 100)).toEqual({ text: '-10.0%', tone: 'down' });
    expect(delta(100.2, 100)).toEqual({ text: '+0.2%', tone: 'flat' });
    expect(delta(5, null)).toEqual({ text: '—', tone: 'none' });
    expect(delta(5, 0)).toEqual({ text: '—', tone: 'none' });
  });
});

describe('bucketDefs', () => {
  it('splits each period into summary rows', () => {
    expect(bucketDefs('day', 24).map(b => b.label)).toEqual([
      '00–04',
      '04–08',
      '08–12',
      '12–16',
      '16–20',
      '20–24'
    ]);
    expect(bucketDefs('week', 168)).toHaveLength(7);
    expect(bucketDefs('month', 31).map(b => [b.from, b.to])).toEqual([
      [0, 7],
      [7, 14],
      [14, 21],
      [21, 28],
      [28, 31]
    ]);
  });
});

describe('formatValue', () => {
  it('uses the metric unit', () => {
    expect(formatValue('cpu', 12.345)).toBe('12.3%');
    expect(formatValue('net', 4)).toBe('4.0 KB/s');
    expect(formatValue('load', 0.5)).toBe('0.50');
    expect(formatValue('mem', null)).toBe('—');
  });
});
