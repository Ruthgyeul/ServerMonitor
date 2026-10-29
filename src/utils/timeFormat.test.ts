import { describe, expect, it } from 'vitest';

import {
  formatAge,
  formatDuration,
  formatHourMinute,
  formatShortStamp,
  formatTimestamp
} from '@/utils/timeFormat';

describe('formatTimestamp / formatHourMinute', () => {
  it('formats local time with zero padding', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(formatTimestamp(at)).toBe('2026-01-02 03:04:05');
    expect(formatHourMinute(at)).toBe('03:04');
    expect(formatShortStamp(at)).toBe('01-02 03:04');
  });
});

describe('formatAge', () => {
  it('collapses to the largest whole unit', () => {
    expect(formatAge(0)).toBe('now');
    expect(formatAge(44_000)).toBe('now');
    expect(formatAge(50_000)).toBe('1m');
    expect(formatAge(59 * 60_000)).toBe('59m');
    expect(formatAge(3 * 3_600_000)).toBe('3h');
    expect(formatAge(50 * 3_600_000)).toBe('2d');
  });

  it('treats negative input as now', () => {
    expect(formatAge(-5000)).toBe('now');
  });
});

describe('formatDuration', () => {
  it('spells out units and pluralizes', () => {
    expect(formatDuration(1000)).toBe('1 second');
    expect(formatDuration(12_000)).toBe('12 seconds');
    expect(formatDuration(60_000)).toBe('1 minute');
    expect(formatDuration(5 * 3_600_000)).toBe('5 hours');
    expect(formatDuration(47 * 3_600_000)).toBe('47 hours');
    expect(formatDuration(72 * 3_600_000)).toBe('3 days');
  });
});
