// Centralized so the whole dashboard picks colors by the same rules. Color
// values come from src/lib/theme.ts (the canonical palette) rather than being
// hardcoded here a second time.

import { TERM } from '@/lib/theme';

export const COLORS = {
  ok: TERM.green,
  warn: TERM.yellow,
  critical: TERM.red,
  idle: '#374151',
  empty: '#111827',
  muted: '#6b7280'
} as const;

export function statusColor(percentage: number): string {
  if (percentage < 50) return COLORS.ok;
  if (percentage < 80) return COLORS.warn;
  return COLORS.critical;
}

export function tempColor(temperature: number | 'N/A'): string {
  if (temperature === 'N/A') return '#9ca3af';
  if (temperature <= 50) return TERM.green;
  if (temperature <= 65) return TERM.yellow;
  if (temperature <= 74) return '#fb923c';
  return TERM.red;
}

// Load is only meaningful divided by the core count. 4.0 on 4 cores differs
// from 4.0 on 1 core. Uses the same gradient as the grid, but clips the dark
// end for text readability.
export function loadColor(load: number, cores: number): string {
  const perCore = cores > 0 ? load / cores : load;
  return heatColor(Math.max(TEXT_HEAT_FLOOR, perCore));
}

// A continuous gradient: green when load is low, then yellow -> orange -> red
// as it rises. Stepping it discretely would make 0.59 and 0.61 completely
// different colors and hide the trend.
const HEAT_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [14, 68, 41]], // nearly idle — dark green
  [0.35, [38, 166, 65]],
  [0.6, [250, 204, 21]],
  [0.8, [249, 115, 22]],
  [1, [239, 68, 68]] // saturated — red
];

// The gradient's darkest green is too hard to read as text on a dark background.
const TEXT_HEAT_FLOOR = 0.35;

// ratio is load normalized to 0 (idle)-1 (saturated). Out of range clamps to the end colors.
export function heatColor(ratio: number): string {
  // NaN passes clamp through and becomes rgb(NaN,...), so block it first. Don't
  // block +/-Infinity — the clamp below folding it to an end (idle/saturated) is more natural.
  if (Number.isNaN(ratio)) return COLORS.muted;
  const t = Math.min(1, Math.max(0, ratio));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [prevAt, prev] = HEAT_STOPS[i - 1];
    const [nextAt, next] = HEAT_STOPS[i];
    if (t > nextAt) continue;
    const span = nextAt - prevAt;
    const k = span > 0 ? (t - prevAt) / span : 0;
    const channels = prev.map((value, index) => Math.round(value + (next[index] - value) * k));
    return `rgb(${channels.join(', ')})`;
  }
  return COLORS.critical;
}

// Sections with no value are left empty in the background color. Treats a per-core load of 1.0 as saturation.
export function loadCellColor(load: number | null, cores: number): string {
  if (load === null) return COLORS.empty;
  const perCore = cores > 0 ? load / cores : load;
  return heatColor(perCore);
}

export const ALERT_LEVEL_COLORS: Record<string, string> = {
  ok: TERM.green,
  info: '#60a5fa',
  warning: TERM.yellow,
  critical: TERM.red
};
