import { describe, expect, it } from 'vitest';

import { computeCpuUsage, parseCpuLine } from '@/utils/collectors/cpu';

describe('parseCpuLine', () => {
  it('sums jiffies and folds iowait into idle', () => {
    // user nice system idle iowait irq softirq steal
    const times = parseCpuLine('cpu  100 0 50 800 40 0 10 5');
    expect(times.iowait).toBe(40);
    expect(times.steal).toBe(5);
    expect(times.idle).toBe(840); // idle(800) + iowait(40)
    expect(times.total).toBe(1005);
  });

  it('throws on an unparsable line', () => {
    expect(() => parseCpuLine('cpu x y z')).toThrow();
  });
});

describe('computeCpuUsage', () => {
  it('derives usage, iowait and steal from the delta between two samples', () => {
    const previous = {
      total: parseCpuLine('cpu  100 0 50 800 40 0 10 5'),
      perCore: [parseCpuLine('cpu0 50 0 25 400 20 0 5 2')]
    };
    // total delta 250, idle delta 100 -> 60% busy over the interval.
    const current = {
      total: parseCpuLine('cpu  200 0 100 900 40 0 10 5'),
      perCore: [parseCpuLine('cpu0 100 0 50 450 20 0 5 2')]
    };

    const usage = computeCpuUsage(previous, current);
    expect(usage.total).toBe(60);
    expect(usage.perCore).toEqual([60]);
    expect(usage.iowait).toBe(0); // iowait unchanged across the samples
    expect(usage.steal).toBe(0);
  });

  it('returns 0 when there is no elapsed jiffy delta', () => {
    const sample = { total: parseCpuLine('cpu 1 0 1 1 0 0 0 0'), perCore: [] };
    expect(computeCpuUsage(sample, sample).total).toBe(0);
  });
});
