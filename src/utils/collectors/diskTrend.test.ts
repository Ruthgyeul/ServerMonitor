import { describe, expect, it } from 'vitest';

import { predictHoursToFull } from '@/utils/collectors/diskTrend';

const HOUR = 3_600_000;

describe('predictHoursToFull', () => {
  it('estimates the time left when it fills steadily', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    // 80% -> 84% over 4 hours (1%p/hour). 16%p left -> 16 hours.
    const samples = [
      { at: now - 4 * HOUR, percent: 80 },
      { at: now, percent: 84 }
    ];
    expect(predictHoursToFull(samples, now)).toBe(16);
  });

  it('does not forecast when flat/shrinking', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    expect(
      predictHoursToFull(
        [
          { at: now - 4 * HOUR, percent: 50 },
          { at: now, percent: 50 }
        ],
        now
      )
    ).toBeNull();
    expect(
      predictHoursToFull(
        [
          { at: now - 4 * HOUR, percent: 60 },
          { at: now, percent: 55 }
        ],
        now
      )
    ).toBeNull();
  });

  it('cannot forecast with only one sample', () => {
    const now = Date.now();
    expect(predictHoursToFull([{ at: now, percent: 90 }], now)).toBeNull();
  });

  it('returns 0 when already full', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const samples = [
      { at: now - 2 * HOUR, percent: 99 },
      { at: now, percent: 100 }
    ];
    expect(predictHoursToFull(samples, now)).toBe(0);
  });
});
