import type { ChartMark } from '@/components/charts/HoverSparkline';
import { PALETTE } from '@/lib/theme';
import type { HistoryRange, HostEvent, HostEventKind } from '@/types/system';
import { formatTimestamp } from '@/utils/timeFormat';

// Pure helpers that turn /api/history and /api/events payloads into what the
// overview charts draw.

export const RANGES: readonly HistoryRange[] = ['1h', '6h', '24h', '7d'];

export const RANGE_MS: Record<HistoryRange, number> = {
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000
};

export const X_LABELS: Record<HistoryRange, string[]> = {
  '1h': ['-60m', '-45m', '-30m', '-15m', 'now'],
  '6h': ['-6h', '-4.5h', '-3h', '-1.5h', 'now'],
  '24h': ['-24h', '-18h', '-12h', '-6h', 'now'],
  '7d': ['-7d', '-5d', '-3d', '-1d', 'now']
};

export const EVENT_STYLE: Record<HostEventKind, { color: string; label: string }> = {
  reboot: { color: PALETTE.crit, label: 'Reboot' },
  deploy: { color: PALETTE.ok, label: 'Deploy' },
  restart: { color: PALETTE.warn, label: 'Restart' }
};

// Tooltip time for a bucket start: "14:05" within a day, "10-27 14:00" for 7d.
export function pointLabel(at: string, range: HistoryRange): string {
  const stamp = formatTimestamp(new Date(at).getTime());
  return range === '7d' ? stamp.slice(5, 16) : stamp.slice(11, 16);
}

// Markers for the events inside the chart window, positioned 0 (oldest) – 1 (now).
export function eventMarks(events: HostEvent[], range: HistoryRange, now: number): ChartMark[] {
  const window = RANGE_MS[range];
  return events.flatMap(event => {
    const age = now - new Date(event.at).getTime();
    if (age < 0 || age > window) return [];
    const style = EVENT_STYLE[event.kind];
    return [
      {
        fraction: 1 - age / window,
        color: style.color,
        tip: `${style.label} · ${event.label} · ${formatTimestamp(new Date(event.at).getTime())}`
      }
    ];
  });
}

// Per-kind counts inside the window, for the legend under the chart.
export function eventCounts(
  events: HostEvent[],
  range: HistoryRange,
  now: number
): Record<HostEventKind, number> {
  const counts: Record<HostEventKind, number> = { reboot: 0, deploy: 0, restart: 0 };
  for (const event of events) {
    const age = now - new Date(event.at).getTime();
    if (age >= 0 && age <= RANGE_MS[range]) counts[event.kind] += 1;
  }
  return counts;
}

// Ranges built from one- and five-minute buckets, where the live reading is a
// fair stand-in for the bucket still filling. A 15-minute or hourly average
// keeps its own value: swapping in an instant reading would spike or drop the
// line at "now".
const LIVE_RANGES: ReadonlySet<HistoryRange> = new Set<HistoryRange>(['1h', '6h']);

// The newest bucket is still filling, so on the short ranges draw the live
// reading as its value.
export function withLive(
  values: (number | null)[],
  live: number | null,
  range: HistoryRange
): (number | null)[] {
  if (!LIVE_RANGES.has(range)) return values;
  if (values.length === 0) return live === null ? [] : [live];
  return [...values.slice(0, -1), live ?? values[values.length - 1]];
}
