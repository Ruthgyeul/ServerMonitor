// Least-squares slope of a time series, in value units per day. null with
// fewer than two usable points or no time spread.
export function slopePerDay(points: { at: string; value: number | null }[]): number | null {
  const usable = points.filter((point): point is { at: string; value: number } => point.value !== null);
  if (usable.length < 2) return null;
  const xs = usable.map(point => new Date(point.at).getTime() / 86_400_000);
  const ys = usable.map(point => point.value);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  xs.forEach((x, index) => {
    numerator += (x - meanX) * (ys[index] - meanY);
    denominator += (x - meanX) ** 2;
  });
  return denominator === 0 ? null : numerator / denominator;
}

// "+0.31% / day", "−1.20% / day" or "stable" when the change is negligible.
export function describeSlope(slope: number | null, unit = '%'): string {
  if (slope === null || Math.abs(slope) < 0.01) return 'stable';
  return `${slope > 0 ? '+' : '−'}${Math.abs(slope).toFixed(2)}${unit} / day`;
}
