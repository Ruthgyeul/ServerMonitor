import { describe, expect, it } from 'vitest';

import { COLORS, heatColor, loadCellColor, loadColor, statusColor, tempColor } from '@/utils/statusColors';

// rgb(r, g, b) 를 [r,g,b] 로. 색 자체보다 "초록→빨강 방향" 을 확인하려는 것이다.
function channels(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!match) throw new Error(`not an rgb() color: ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// 색상환 각도(0=빨강, 120=초록). 채널값으로는 단조성을 볼 수 없다 — 주황의 빨강
// 채널(249)이 빨강(239)보다 오히려 크기 때문이다. 심각도는 hue 회전으로 읽어야 한다.
function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;

  const span = max - min;
  const raw =
    max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (raw * 60 + 360) % 360;
}

describe('heatColor', () => {
  it('부하가 오를수록 색이 초록에서 빨강 쪽으로만 돈다', () => {
    const hues = [0, 0.25, 0.5, 0.75, 1].map(r => hue(channels(heatColor(r))));

    // 단조 감소(초록 120도대 → 빨강 0도). 되돌아가는 구간이 있으면 추세가
    // 잘못 읽힌다 — 예를 들어 더 바쁜 구간이 덜 심각해 보인다.
    for (let i = 1; i < hues.length; i += 1) {
      expect(hues[i]).toBeLessThan(hues[i - 1]);
    }
    expect(hues.at(-1)).toBe(0);
  });

  it('양 끝은 초록과 빨강이다', () => {
    const [lowR, lowG] = channels(heatColor(0));
    expect(lowG).toBeGreaterThan(lowR);

    const [highR, highG] = channels(heatColor(1));
    expect(highR).toBeGreaterThan(highG);
  });

  it('범위를 벗어난 값은 양 끝으로 고정된다', () => {
    expect(heatColor(-5)).toBe(heatColor(0));
    expect(heatColor(9)).toBe(heatColor(1));
  });

  it('유한하지 않은 값에 rgb(NaN) 을 내지 않는다', () => {
    // clamp 만 있으면 NaN 이 그대로 통과해 rgb(NaN, NaN, NaN) 이 된다.
    expect(heatColor(NaN)).toBe(COLORS.muted);
    expect(heatColor(Infinity)).toBe(heatColor(1));
  });
});

describe('loadCellColor', () => {
  it('값이 없는 구간은 배경색으로 비운다', () => {
    expect(loadCellColor(null, 8)).toBe(COLORS.empty);
  });

  it('코어 수로 나눈 뒤 색을 고른다', () => {
    // 8코어의 8.0 과 1코어의 1.0 은 둘 다 코어당 1.0 이라 같은 색이어야 한다.
    expect(loadCellColor(8, 8)).toBe(loadCellColor(1, 1));
    // 같은 로드라도 코어가 많으면 덜 빨갛다.
    expect(channels(loadCellColor(4, 8))[0]).toBeLessThan(channels(loadCellColor(4, 2))[0]);
  });

  it('코어 수를 모르면(0) 로드를 그대로 쓴다', () => {
    expect(loadCellColor(1, 0)).toBe(heatColor(1));
  });
});

describe('loadColor', () => {
  it('유휴 상태에서도 어두운 초록으로 떨어지지 않는다', () => {
    // 다크 배경 위 글자라 그라데이션의 제일 어두운 끝은 읽히지 않는다.
    expect(loadColor(0, 8)).not.toBe(heatColor(0));
    expect(loadColor(0, 8)).toBe(heatColor(0.35));
  });

  it('포화 구간에서는 격자와 같은 빨강이다', () => {
    expect(loadColor(8, 8)).toBe(heatColor(1));
  });
});

describe('statusColor', () => {
  it('50/80 을 경계로 초록·주황·빨강을 고른다', () => {
    expect(statusColor(49)).toBe(COLORS.ok);
    expect(statusColor(50)).toBe(COLORS.warn);
    expect(statusColor(79)).toBe(COLORS.warn);
    expect(statusColor(80)).toBe(COLORS.critical);
  });
});

describe('tempColor', () => {
  it('센서가 없으면 회색이다', () => {
    expect(tempColor('N/A')).toBe('#9ca3af');
  });

  it('온도가 오를수록 단계가 올라간다', () => {
    const steps = [tempColor(40), tempColor(60), tempColor(70), tempColor(80)];
    expect(new Set(steps).size).toBe(4);
  });
});
