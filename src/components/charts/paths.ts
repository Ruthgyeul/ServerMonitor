// SVG path builders for the console charts. Pure, so they're unit-tested and
// shared by the sparklines, the throughput chart and the capacity rows.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// "M x,y L x,y …" through the non-null values, scaled into `box` with `max` at
// the top and `min` at the bottom. Null values break the line (a new M), so a
// gap in sampling shows as a gap rather than a straight bridge.
export function linePath(values: (number | null)[], box: Box, max: number, min = 0): string {
  if (values.length === 0) return '';
  const span = max - min || 1;
  const step = values.length > 1 ? box.width / (values.length - 1) : 0;
  let path = '';
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const clamped = Math.min(max, Math.max(min, value));
    const x = box.x + index * step;
    const y = box.y + box.height - ((clamped - min) / span) * box.height;
    path += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  });
  return path.trim();
}

// The line closed down to the baseline, for a filled area under it. Only the
// last continuous run is filled when the series has gaps.
export function areaPath(values: (number | null)[], box: Box, max: number, min = 0): string {
  const line = linePath(values, box, max, min);
  if (!line) return '';
  const lastRun = line.slice(line.lastIndexOf('M'));
  const points = lastRun.slice(1).split(' L');
  const firstX = points[0].split(',')[0];
  const lastX = points[points.length - 1].split(',')[0];
  const bottom = (box.y + box.height).toFixed(1);
  return `${lastRun} L${lastX},${bottom} L${firstX},${bottom} Z`;
}

// The smallest "nice" axis maximum at or above `value` (with 15% headroom).
const NICE_STEPS = [1, 2, 4, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];

export function niceMax(value: number): number {
  const target = Math.max(0, value) * 1.15;
  if (target <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(target) - 1);
  const step = NICE_STEPS.find(candidate => candidate * magnitude >= target);
  return (step ?? 100) * magnitude;
}

// Index into a series of `length` points for a pointer at fraction `f` (0–1)
// across the plot area.
export function indexAt(fraction: number, length: number): number {
  if (length <= 1) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * (length - 1));
}

// Left-pad a short series with gaps so it fills only the right end of a fixed
// window (a chart that has collected 4 of 60 samples draws 4 points at "now").
export function padToWindow(values: (number | null)[], length: number): (number | null)[] {
  if (values.length >= length) return values.slice(-length);
  return [...Array<null>(length - values.length).fill(null), ...values];
}
