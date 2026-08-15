import { describe, expect, it } from 'vitest';

import { predictHoursToFull } from '@/utils/collectors/diskTrend';

const HOUR = 3_600_000;

describe('predictHoursToFull', () => {
  it('일정하게 차오르면 남은 시간을 추정한다', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    // 4시간 동안 80% → 84% (시간당 1%p). 남은 16%p → 16시간.
    const samples = [
      { at: now - 4 * HOUR, percent: 80 },
      { at: now, percent: 84 }
    ];
    expect(predictHoursToFull(samples, now)).toBe(16);
  });

  it('정체/감소 중이면 예측하지 않는다', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    expect(
      predictHoursToFull(
        [
          { at: now - 4 * HOUR, percent: 50 },
          { at: now, percent: 50 }
        ],
        now
      )
    ).toBeNull();
    expect(
      predictHoursToFull(
        [
          { at: now - 4 * HOUR, percent: 60 },
          { at: now, percent: 55 }
        ],
        now
      )
    ).toBeNull();
  });

  it('샘플이 하나뿐이면 예측할 수 없다', () => {
    const now = Date.now();
    expect(predictHoursToFull([{ at: now, percent: 90 }], now)).toBeNull();
  });

  it('이미 가득 찼으면 0을 준다', () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const samples = [
      { at: now - 2 * HOUR, percent: 99 },
      { at: now, percent: 100 }
    ];
    expect(predictHoursToFull(samples, now)).toBe(0);
  });
});
