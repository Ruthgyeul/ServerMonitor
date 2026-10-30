// Calendar windows and statistics for the Compare page. Pure (all times are
// passed in) so the period maths is unit-tested.

export type CompareMetric = 'cpu' | 'mem' | 'disk' | 'net' | 'load';
export type ComparePeriod = 'day' | 'week' | 'month';

export const METRIC_LABELS: Record<CompareMetric, string> = {
  cpu: 'CPU',
  mem: 'Memory',
  disk: 'Disk',
  net: 'Network',
  load: 'Load'
};

export const PERIOD_LABELS: Record<ComparePeriod, { title: string; current: string; previous: string }> = {
  day: { title: 'Today vs yesterday', current: 'Today', previous: 'Yesterday' },
  week: { title: 'This week vs last week', current: 'This week', previous: 'Last week' },
  month: { title: 'This month vs last month', current: 'This month', previous: 'Last month' }
};

const QUARTER = 15 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// History bucket width requested from /api/history/range.
export type RangeStep = '15m' | '1h';

export interface PeriodWindow {
  start: number;
  end: number;
  prevStart: number;
  prevEnd: number;
  step: RangeStep;
  // Fetched buckets folded into one chart point (24 hourly buckets = one day).
  foldBy: number;
  // Width of one chart point.
  pointMs: number;
  xLabels: string[];
}

// Local-calendar windows: today/yesterday in 15-minute points (96 per day),
// Monday-based weeks in hours, calendar months in days.
export function periodWindow(period: ComparePeriod, now: number): PeriodWindow {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (period === 'day') {
    const start = midnight.getTime();
    return {
      start,
      end: start + DAY,
      prevStart: start - DAY,
      prevEnd: start,
      step: '15m',
      foldBy: 1,
      pointMs: QUARTER,
      xLabels: ['00:00', '06:00', '12:00', '18:00', '24:00']
    };
  }
  if (period === 'week') {
    const weekday = (midnight.getDay() + 6) % 7; // Monday = 0
    const start = new Date(midnight);
    start.setDate(start.getDate() - weekday);
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {
      start: start.getTime(),
      end: end.getTime(),
      prevStart: prevStart.getTime(),
      prevEnd: start.getTime(),
      step: '1h',
      foldBy: 1,
      pointMs: HOUR,
      xLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    };
  }
  const start = new Date(midnight.getFullYear(), midnight.getMonth(), 1);
  const end = new Date(midnight.getFullYear(), midnight.getMonth() + 1, 1);
  const prevStart = new Date(midnight.getFullYear(), midnight.getMonth() - 1, 1);
  return {
    start: start.getTime(),
    end: end.getTime(),
    prevStart: prevStart.getTime(),
    prevEnd: start.getTime(),
    step: '1h',
    foldBy: 24,
    pointMs: DAY,
    xLabels: ['1', '8', '15', '22', '29']
  };
}

// Combine consecutive groups of `size` values — their average, or their peak
// for a series of bucket maxima (nulls ignored; all-null → null).
export function foldPoints(
  values: (number | null)[],
  size: number,
  combine: 'avg' | 'max' = 'avg'
): (number | null)[] {
  if (size <= 1) return values;
  const folded: (number | null)[] = [];
  for (let index = 0; index < values.length; index += size) {
    const group = values.slice(index, index + size).filter((value): value is number => value !== null);
    if (group.length === 0) folded.push(null);
    else if (combine === 'max') folded.push(Math.max(...group));
    else folded.push(group.reduce((sum, value) => sum + value, 0) / group.length);
  }
  return folded;
}

export type StatKind = 'avg' | 'p95' | 'max';

export function stat(values: (number | null)[], kind: StatKind): number | null {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return null;
  if (kind === 'avg') return known.reduce((sum, value) => sum + value, 0) / known.length;
  const sorted = [...known].sort((a, b) => a - b);
  if (kind === 'max') return sorted[sorted.length - 1];
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

export interface Delta {
  text: string;
  tone: 'up' | 'down' | 'flat' | 'none';
}

// Relative change of `current` against `previous`; under ±0.5% reads as flat.
export function delta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null || previous === 0) return { text: '—', tone: 'none' };
  const percent = ((current - previous) / previous) * 100;
  const tone = percent > 0.5 ? 'up' : percent < -0.5 ? 'down' : 'flat';
  return { text: `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`, tone };
}

export interface BucketDef {
  label: string;
  from: number; // point index, inclusive
  to: number; // point index, exclusive
}

// The summary rows under the chart: 4-hour blocks (16 quarter-hour points),
// weekdays, or weeks.
const POINTS_PER_DAY_BLOCK = 16;

export function bucketDefs(period: ComparePeriod, points: number): BucketDef[] {
  if (period === 'day') {
    return Array.from({ length: 6 }, (_, block) => ({
      label: `${String(block * 4).padStart(2, '0')}–${String(block * 4 + 4).padStart(2, '0')}`,
      from: block * POINTS_PER_DAY_BLOCK,
      to: (block + 1) * POINTS_PER_DAY_BLOCK
    }));
  }
  if (period === 'week') {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, day) => ({
      label,
      from: day * 24,
      to: day * 24 + 24
    }));
  }
  return Array.from({ length: Math.ceil(points / 7) }, (_, week) => ({
    label: `Week ${week + 1}`,
    from: week * 7,
    to: Math.min(points, week * 7 + 7)
  }));
}

export function formatValue(metric: CompareMetric, value: number | null): string {
  if (value === null) return '—';
  if (metric === 'load') return value.toFixed(2);
  return `${value.toFixed(1)}${metric === 'net' ? ' KB/s' : '%'}`;
}
