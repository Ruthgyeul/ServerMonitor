import { describe, expect, it } from 'vitest';

import { dailyAverages, forecast, linearSlope } from '@/utils/collectors/capacity';

const HOURS = 14 * 24;

describe('linearSlope', () => {
  it('fits the least-squares slope and skips gaps', () => {
    expect(linearSlope([1, 2, null, 4])).toBeCloseTo(1);
    expect(linearSlope([5])).toBeNull();
  });
});

describe('dailyAverages', () => {
  it('averages each 24-hour block', () => {
    const hourly = [...Array(24).fill(10), ...Array(24).fill(null)];
    expect(dailyAverages(hourly, 2)).toEqual([10, null]);
  });
});

describe('forecast', () => {
  it('needs at least three days of data', () => {
    const hourly = Array.from({ length: HOURS }, (_, hour) => (hour >= HOURS - 48 ? 50 + hour * 0.01 : null));
    expect(forecast(hourly, 52)).toMatchObject({ ratePerDay: null, hoursToFull: null, daysWithData: 2 });
  });

  it('detects slow growth the old 0.1 %/hour floor missed', () => {
    // +0.31 % per day over 14 days, as in the design.
    const hourly = Array.from({ length: HOURS }, (_, hour) => 22 + (hour / 24) * 0.31);
    const result = forecast(hourly, 26);
    expect(result.ratePerDay).toBeCloseTo(0.31, 2);
    expect(result.hoursToFull! / 24).toBeCloseTo((100 - 26) / 0.31, 0);
    expect(result.daily).toHaveLength(14);
    expect(result.daysWithData).toBe(14);
  });

  it('reports no fill time when flat or shrinking', () => {
    const flat = Array.from({ length: HOURS }, () => 40);
    expect(forecast(flat, 40)).toMatchObject({ ratePerDay: 0, hoursToFull: null });
  });
});
