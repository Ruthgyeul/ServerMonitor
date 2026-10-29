// Centralized so the whole dashboard picks colors by the same rules. Color
// values come from src/lib/theme.ts (the canonical palette) rather than being
// hardcoded here a second time.

import { PALETTE, TERM } from '@/lib/theme';
import type { AlertLevel } from '@/types/system';

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
  ok: PALETTE.ok,
  info: PALETTE.accent,
  warning: PALETTE.warn,
  critical: PALETTE.crit
};

// How an alert level renders in the console: the short tag, the tag's text and
// tinted background, and the solid dot/marker color.
export interface LevelStyle {
  tag: string;
  fg: string;
  bg: string;
  dot: string;
}

export const LEVEL_STYLES: Record<AlertLevel, LevelStyle> = {
  critical: { tag: 'CRIT', fg: PALETTE.critFg, bg: 'rgba(239, 95, 90, 0.14)', dot: PALETTE.crit },
  warning: { tag: 'WARN', fg: PALETTE.warnFg, bg: 'rgba(232, 180, 69, 0.12)', dot: PALETTE.warn },
  info: { tag: 'INFO', fg: PALETTE.infoFg, bg: 'rgba(90, 169, 240, 0.12)', dot: PALETTE.accent },
  ok: { tag: 'OK', fg: PALETTE.okFg, bg: 'rgba(60, 207, 145, 0.1)', dot: PALETTE.ok }
};

// Utilization bands used across the console: warn from 70%, critical from 85%.
export const USAGE_WARN = 70;
export const USAGE_CRIT = 85;

// Bar/meter color for a utilization percentage. Below the warn band it uses the
// accent (`calm`) — blue on node bars, green on kiosk tiles.
export function usageColor(percentage: number, calm: string = PALETTE.accent): string {
  if (percentage >= USAGE_CRIT) return PALETTE.crit;
  if (percentage >= USAGE_WARN) return PALETTE.warn;
  return calm;
}

// Container lifecycle → status dot.
export function containerDot(state: string): string {
  switch (state) {
    case 'running':
      return PALETTE.ok;
    case 'paused':
    case 'restarting':
      return PALETTE.warn;
    case 'dead':
      return PALETTE.crit;
    default: // exited / created / unknown
      return PALETTE.faint;
  }
}

// Heatmap cell color for a 0–1 utilization (null = no data): dark green at
// idle, brightening through yellow to red at saturation.
export function rampColor(t: number | null): string {
  if (t === null || !Number.isFinite(t)) return PALETTE.inset;
  const v = Math.min(1, Math.max(0, t));
  const lightness = (0.32 + 0.42 * v).toFixed(3);
  const chroma = (0.04 + 0.1 * v).toFixed(3);
  const hue = (160 - 135 * Math.max(0, v - 0.5) * 2).toFixed(0);
  return `oklch(${lightness} ${chroma} ${hue})`;
}
