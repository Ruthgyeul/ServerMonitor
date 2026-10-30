import { describe, expect, it } from 'vitest';

import { areaPath, indexAt, linePath, niceMax, padToWindow } from '@/components/charts/paths';

const box = { x: 0, y: 0, width: 100, height: 10 };

describe('linePath', () => {
  it('scales values into the box with max at the top', () => {
    expect(linePath([0, 5, 10], box, 10)).toBe('M0.0,10.0 L50.0,5.0 L100.0,0.0');
  });

  it('clamps out-of-range values and breaks on nulls', () => {
    expect(linePath([20, 20, null, -5, -5], box, 10)).toBe('M0.0,0.0 L25.0,0.0 M75.0,10.0 L100.0,10.0');
  });

  it('draws a lone sample between gaps as a short level dash', () => {
    // step 25 → a quarter step (6.25) either side, clipped to the box
    expect(linePath([null, null, 4, null, null], box, 10)).toBe('M43.8,6.0 L56.3,6.0');
    expect(linePath([4, null, null, null, null], box, 10)).toBe('M0.0,6.0 L6.3,6.0');
  });

  it('returns an empty path for no data', () => {
    expect(linePath([], box, 10)).toBe('');
    expect(linePath([null, null], box, 10)).toBe('');
  });
});

describe('areaPath', () => {
  it('closes the line down to the baseline', () => {
    expect(areaPath([0, 10], box, 10)).toBe('M0.0,10.0 L100.0,0.0 L100.0,10.0 L0.0,10.0 Z');
  });

  it('fills every run across a gap, not just the last', () => {
    expect(areaPath([10, 10, null, 10, 10], box, 10)).toBe(
      'M0.0,0.0 L25.0,0.0 L25.0,10.0 L0.0,10.0 Z M75.0,0.0 L100.0,0.0 L100.0,10.0 L75.0,10.0 Z'
    );
  });

  it('returns an empty path for no data', () => {
    expect(areaPath([null], box, 10)).toBe('');
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

describe('padToWindow', () => {
  it('right-aligns a short series and trims a long one', () => {
    expect(padToWindow([1, 2], 4)).toEqual([null, null, 1, 2]);
    expect(padToWindow([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
});
