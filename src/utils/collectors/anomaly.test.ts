import { describe, expect, it } from 'vitest';

import { isAnomalous, mean, stddev, zScore } from '@/utils/collectors/anomaly';

describe('mean / stddev', () => {
  it('computes sample statistics', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([2, 4, 6])).toBeCloseTo(2, 5); // sample stddev
    expect(stddev([5, 5, 5])).toBe(0);
  });
});

describe('zScore', () => {
  it('returns standard deviations from the mean', () => {
    // series mean 10, sd 5 → value 20 is +2σ
    const z = zScore(20, [5, 10, 15]);
    expect(z).toBeCloseTo(2, 5);
  });

  it('is null for a flat or tiny series', () => {
    expect(zScore(5, [5, 5, 5])).toBeNull();
    expect(zScore(5, [5])).toBeNull();
  });
});

describe('isAnomalous', () => {
  const baseline = [8, 9, 8, 10, 9, 8, 9, 10]; // ~9% CPU, low variance

  it('flags a value far from the baseline', () => {
    expect(isAnomalous(60, baseline)).toBe(true);
  });

  it('does not flag a value near the baseline', () => {
    expect(isAnomalous(9, baseline)).toBe(false);
  });

  it('requires a minimum number of samples', () => {
    expect(isAnomalous(60, [8, 9])).toBe(false);
  });
});
