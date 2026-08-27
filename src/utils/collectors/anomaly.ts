// Simple statistical anomaly detection to complement the fixed thresholds. A
// value can be "normal" in absolute terms yet wildly out of line with this
// host's own recent baseline (e.g. CPU steady at 8% for a week, suddenly 45%).
// We flag that with a z-score against the recent history the process already
// keeps (history.ts hourly buckets), so it needs no extra storage.
//
// All pure functions so the maths is unit-testable.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

export function stddev(xs: number[], m: number = mean(xs)): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// The number of standard deviations `value` sits from the series mean. null when
// there isn't enough data or the series is flat (zero variance), where a z-score
// is undefined/meaningless.
export function zScore(value: number, series: number[]): number | null {
  if (series.length < 2) return null;
  const m = mean(series);
  const sd = stddev(series, m);
  if (sd === 0) return null;
  return (value - m) / sd;
}

export interface AnomalyOptions {
  minSamples?: number;
  threshold?: number; // z-score magnitude to flag
}

// Whether `value` is anomalous versus its baseline. Requires a minimum number of
// baseline samples so a brand-new deployment doesn't fire on noise.
export function isAnomalous(value: number, series: number[], options: AnomalyOptions = {}): boolean {
  const { minSamples = 6, threshold = 3 } = options;
  if (series.length < minSamples) return false;
  const z = zScore(value, series);
  return z !== null && Math.abs(z) >= threshold;
}
