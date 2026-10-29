import { describe, expect, it } from 'vitest';

import { LEVEL_STYLES, containerDot, rampColor, usageColor } from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';

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
