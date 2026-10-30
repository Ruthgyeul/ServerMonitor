import { CapacityForecast } from '@/types/system';
import { getRange, HOUR_MS } from '@/utils/collectors/history';
import { round } from '@/utils/collectors/shell';

// The Capacity forecast panel: a 14-day least-squares trend of disk and memory
// usage from the persisted hourly history, the daily rate and when it reaches
// 100%. (The disk/memory-fill ALERTS keep their short 6-hour window in
// diskTrend.ts / memTrend.ts, so a sudden fill still alerts quickly.)

export const WINDOW_DAYS = 14;
export const MIN_DAYS = 3;
// Growth below this is noise for a forecast (≈ 2000 days to fill from empty).
const MIN_RATE_PER_DAY = 0.05;
const DAY_HOURS = 24;

// Pure: least-squares slope (per x unit) of the non-null points, or null.
export function linearSlope(values: (number | null)[]): number | null {
  const points = values.flatMap((value, index) => (value === null ? [] : [[index, value] as const]));
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of points) {
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  return denominator === 0 ? null : numerator / denominator;
}

// Pure: hourly values (oldest first) → one average per day.
export function dailyAverages(hourly: (number | null)[], days: number): (number | null)[] {
  return Array.from({ length: days }, (_, day) => {
    const slice = hourly
      .slice(day * DAY_HOURS, (day + 1) * DAY_HOURS)
      .filter((value): value is number => value !== null);
    return slice.length ? round(slice.reduce((sum, value) => sum + value, 0) / slice.length, 2) : null;
  });
}

// Pure: forecast from `WINDOW_DAYS` of hourly values and the current reading.
export function forecast(hourly: (number | null)[], current: number | null): CapacityForecast {
  const daily = dailyAverages(hourly, WINDOW_DAYS);
  const daysWithData = daily.filter(value => value !== null).length;
  const slopePerHour = linearSlope(hourly);
  if (daysWithData < MIN_DAYS || slopePerHour === null || current === null) {
    return { ratePerDay: null, hoursToFull: null, daily, daysWithData };
  }
  const ratePerDay = round(slopePerHour * DAY_HOURS, 2);
  const filling = ratePerDay >= MIN_RATE_PER_DAY;
  return {
    ratePerDay,
    hoursToFull: filling ? Math.max(0, round(((100 - current) / ratePerDay) * DAY_HOURS, 1)) : null,
    daily,
    daysWithData
  };
}

export function getCapacityForecast(
  metric: 'disk' | 'mem',
  current: number | null,
  now: number = Date.now()
): CapacityForecast {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
  const start = end - WINDOW_DAYS * DAY_HOURS * HOUR_MS;
  return forecast(getRange(metric, start, end, HOUR_MS), current);
}
