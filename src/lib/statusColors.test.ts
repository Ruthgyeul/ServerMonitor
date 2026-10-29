import { describe, expect, it } from 'vitest';

import {
  COLORS,
  LEVEL_STYLES,
  heatColor,
  loadCellColor,
  loadColor,
  statusColor,
  tempColor,
  usageColor,
  containerDot,
  rampColor
} from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';

// rgb(r, g, b) to [r,g,b]. The point is checking the "green->red direction" rather than the exact color.
function channels(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!match) throw new Error(`not an rgb() color: ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Color-wheel angle (0=red, 120=green). Channel values can't show monotonicity —
// orange's red channel (249) is actually larger than red's (239). Severity must be read via hue rotation.
function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;

  const span = max - min;
  const raw = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (raw * 60 + 360) % 360;
}

describe('heatColor', () => {
  it('rotates color only from green toward red as load rises', () => {
    const hues = [0, 0.25, 0.5, 0.75, 1].map(r => hue(channels(heatColor(r))));

    // Monotonic decrease (green ~120deg -> red 0deg). A reversal would misread the
    // trend — e.g. a busier stretch would look less severe.
    for (let i = 1; i < hues.length; i += 1) {
      expect(hues[i]).toBeLessThan(hues[i - 1]);
    }
    expect(hues.at(-1)).toBe(0);
  });

  it('the two ends are green and red', () => {
    const [lowR, lowG] = channels(heatColor(0));
    expect(lowG).toBeGreaterThan(lowR);

    const [highR, highG] = channels(heatColor(1));
    expect(highR).toBeGreaterThan(highG);
  });

  it('clamps out-of-range values to the ends', () => {
    expect(heatColor(-5)).toBe(heatColor(0));
    expect(heatColor(9)).toBe(heatColor(1));
  });

  it('does not emit rgb(NaN) for non-finite values', () => {
    // With clamp alone, NaN passes through and becomes rgb(NaN, NaN, NaN).
    expect(heatColor(NaN)).toBe(COLORS.muted);
    expect(heatColor(Infinity)).toBe(heatColor(1));
  });
});

describe('loadCellColor', () => {
  it('leaves sections with no value in the background color', () => {
    expect(loadCellColor(null, 8)).toBe(COLORS.empty);
  });

  it('picks the color after dividing by the core count', () => {
    // 8.0 on 8 cores and 1.0 on 1 core are both 1.0 per core, so the color must match.
    expect(loadCellColor(8, 8)).toBe(loadCellColor(1, 1));
    // For the same load, more cores means less red.
    expect(channels(loadCellColor(4, 8))[0]).toBeLessThan(channels(loadCellColor(4, 2))[0]);
  });

  it('uses the load as-is when the core count is unknown (0)', () => {
    expect(loadCellColor(1, 0)).toBe(heatColor(1));
  });
});

describe('loadColor', () => {
  it('does not fall to dark green even when idle', () => {
    // As text on a dark background, the darkest end of the gradient isn't readable.
    expect(loadColor(0, 8)).not.toBe(heatColor(0));
    expect(loadColor(0, 8)).toBe(heatColor(0.35));
  });

  it('is the same red as the grid in the saturated range', () => {
    expect(loadColor(8, 8)).toBe(heatColor(1));
  });
});

describe('statusColor', () => {
  it('picks green/orange/red at the 50/80 boundaries', () => {
    expect(statusColor(49)).toBe(COLORS.ok);
    expect(statusColor(50)).toBe(COLORS.warn);
    expect(statusColor(79)).toBe(COLORS.warn);
    expect(statusColor(80)).toBe(COLORS.critical);
  });
});

describe('tempColor', () => {
  it('is gray when there is no sensor', () => {
    expect(tempColor('N/A')).toBe('#9ca3af');
  });

  it('steps up as the temperature rises', () => {
    const steps = [tempColor(40), tempColor(60), tempColor(70), tempColor(80)];
    expect(new Set(steps).size).toBe(4);
  });
});

describe('usageColor', () => {
  it('stays calm below 70%, warns from 70% and is critical from 85%', () => {
    expect(usageColor(0)).toBe(PALETTE.accent);
    expect(usageColor(69.9)).toBe(PALETTE.accent);
    expect(usageColor(70)).toBe(PALETTE.warn);
    expect(usageColor(84.9)).toBe(PALETTE.warn);
    expect(usageColor(85)).toBe(PALETTE.crit);
  });

  it('uses the given calm color below the warn band', () => {
    expect(usageColor(12, PALETTE.ok)).toBe(PALETTE.ok);
    expect(usageColor(90, PALETTE.ok)).toBe(PALETTE.crit);
  });
});

describe('LEVEL_STYLES', () => {
  it('maps every alert level to a short tag', () => {
    expect(
      Object.fromEntries(Object.entries(LEVEL_STYLES).map(([level, style]) => [level, style.tag]))
    ).toEqual({
      critical: 'CRIT',
      warning: 'WARN',
      info: 'INFO',
      ok: 'OK'
    });
  });
});

describe('containerDot', () => {
  it('colors running green, transitional amber, dead red and the rest faint', () => {
    expect(containerDot('running')).toBe(PALETTE.ok);
    expect(containerDot('restarting')).toBe(PALETTE.warn);
    expect(containerDot('dead')).toBe(PALETTE.crit);
    expect(containerDot('exited')).toBe(PALETTE.faint);
  });
});

describe('rampColor', () => {
  it('renders missing data as the inset surface and clamps the ramp', () => {
    expect(rampColor(null)).toBe(PALETTE.inset);
    expect(rampColor(0)).toBe('oklch(0.320 0.040 160)');
    expect(rampColor(1)).toBe('oklch(0.740 0.140 25)');
    expect(rampColor(5)).toBe(rampColor(1));
  });
});
