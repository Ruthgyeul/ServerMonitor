import { describe, expect, it } from 'vitest';

import { describeSlope, slopePerDay } from '@/components/overview/trend';

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();

describe('slopePerDay', () => {
  it('fits a straight line through the usable points', () => {
    expect(
      slopePerDay([
        { at: day(0), value: 10 },
        { at: day(1), value: null },
        { at: day(2), value: 11 }
      ])
    ).toBeCloseTo(0.5);
  });

  it('needs two points spread over time', () => {
    expect(slopePerDay([{ at: day(0), value: 10 }])).toBeNull();
    expect(
      slopePerDay([
        { at: day(0), value: 10 },
        { at: day(0), value: 12 }
      ])
    ).toBeNull();
  });
});

describe('describeSlope', () => {
  it('formats growth, shrinkage and flat series', () => {
    expect(describeSlope(0.314)).toBe('+0.31% / day');
    expect(describeSlope(-1.2)).toBe('−1.20% / day');
    expect(describeSlope(0.001)).toBe('stable');
    expect(describeSlope(null)).toBe('stable');
  });
});
