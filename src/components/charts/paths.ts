// SVG path builders for the console charts. Pure, so they're unit-tested and
// shared by the sparklines, the throughput chart and the capacity rows.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Point = [x: number, y: number];

// The non-null values scaled into `box` (`max` at the top, `min` at the
// bottom), split into continuous runs at each null. A run of one sample (a
// lone bucket between gaps) is widened into a short level dash a quarter step
// either side, so it stays visible instead of collapsing to a zero-length
// line.
function runs(values: (number | null)[], box: Box, max: number, min: number): Point[][] {
  const span = max - min || 1;
  const step = values.length > 1 ? box.width / (values.length - 1) : 0;
  const result: Point[][] = [];
  let run: Point[] = [];
  const close = () => {
    if (run.length === 1) {
      const [x, y] = run[0];
      const half = Math.max(step / 4, 1);
      run = [
        [Math.max(box.x, x - half), y],
        [Math.min(box.x + box.width, x + half), y]
      ];
    }
    if (run.length > 0) result.push(run);
    run = [];
  };
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      close();
      return;
    }
    const clamped = Math.min(max, Math.max(min, value));
    run.push([box.x + index * step, box.y + box.height - ((clamped - min) / span) * box.height]);
  });
  close();
  return result;
}

const pointText = ([x, y]: Point) => `${x.toFixed(1)},${y.toFixed(1)}`;

// "M x,y L x,y …" through the non-null values. Null values break the line (a
// new M), so a gap in sampling shows as a gap rather than a straight bridge.
export function linePath(values: (number | null)[], box: Box, max: number, min = 0): string {
  return runs(values, box, max, min)
    .map(run => run.map((point, index) => `${index === 0 ? 'M' : 'L'}${pointText(point)}`).join(' '))
    .join(' ');
}

// Every run of the line closed down to the baseline, for a filled area under
// it that matches the line across gaps.
export function areaPath(values: (number | null)[], box: Box, max: number, min = 0): string {
  const bottom = (box.y + box.height).toFixed(1);
  return runs(values, box, max, min)
    .map(run => {
      const line = run.map((point, index) => `${index === 0 ? 'M' : 'L'}${pointText(point)}`).join(' ');
      const first = run[0][0].toFixed(1);
      const last = run[run.length - 1][0].toFixed(1);
      return `${line} L${last},${bottom} L${first},${bottom} Z`;
    })
    .join(' ');
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
