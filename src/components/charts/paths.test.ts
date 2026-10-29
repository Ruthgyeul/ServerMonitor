import { describe, expect, it } from 'vitest';

import { areaPath, indexAt, linePath, niceMax } from '@/components/charts/paths';

const box = { x: 0, y: 0, width: 100, height: 10 };

describe('linePath', () => {
  it('scales values into the box with max at the top', () => {
    expect(linePath([0, 5, 10], box, 10)).toBe('M0.0,10.0 L50.0,5.0 L100.0,0.0');
  });

  it('clamps out-of-range values and breaks on nulls', () => {
    expect(linePath([20, null, -5], box, 10)).toBe('M0.0,0.0 M100.0,10.0');
  });

  it('returns an empty path for no data', () => {
    expect(linePath([], box, 10)).toBe('');
    expect(linePath([null, null], box, 10)).toBe('');
  });
});

describe('areaPath', () => {
  it('closes the last run down to the baseline', () => {
    expect(areaPath([0, 10], box, 10)).toBe('M0.0,10.0 L100.0,0.0 L100.0,10.0 L0.0,10.0 Z');
  });
});

describe('niceMax', () => {
  it('rounds up to a readable axis maximum with headroom', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(900)).toBe(1200);
    expect(niceMax(0.3)).toBe(0.4);
  });
});

describe('indexAt', () => {
  it('maps a pointer fraction to the nearest point', () => {
    expect(indexAt(0, 60)).toBe(0);
    expect(indexAt(1, 60)).toBe(59);
    expect(indexAt(0.5, 3)).toBe(1);
    expect(indexAt(2, 3)).toBe(2);
    expect(indexAt(0.4, 1)).toBe(0);
  });
});
