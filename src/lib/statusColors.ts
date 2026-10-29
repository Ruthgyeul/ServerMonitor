// Centralized so every console page picks status colors by the same rules.
// Color values come from src/lib/theme.ts (the canonical palette).

import { PALETTE } from '@/lib/theme';
import type { AlertLevel } from '@/types/system';

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
