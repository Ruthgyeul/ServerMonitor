import { describe, expect, it } from 'vitest';

import { parseRunningEntities } from '@/utils/collectors/load';

// 이 파서는 /proc 이 있는 리눅스에서만 실제로 돌아간다. 개발 장비(macOS)에서는
// 경로가 없어 그냥 null 로 빠지므로, 형식 검증은 여기서만 할 수 있다.
describe('parseRunningEntities', () => {
  it('4번째 필드의 실행 중 태스크 수를 읽는다', () => {
    expect(parseRunningEntities('0.42 0.38 0.35 2/1234 5678\n')).toBe(2);
  });

  it('두 자리 이상도 읽는다', () => {
    expect(parseRunningEntities('12.00 9.51 8.20 137/2048 99\n')).toBe(137);
  });

  it('유휴 상태의 1 도 그대로 읽는다', () => {
    // 자기 자신(읽는 프로세스)이 항상 실행 중이라 최소값은 보통 1 이다.
    expect(parseRunningEntities('0.00 0.00 0.00 1/128 42\n')).toBe(1);
  });

  it('총 태스크 수를 실행 수로 착각하지 않는다', () => {
    expect(parseRunningEntities('0.10 0.10 0.10 3/900 12')).not.toBe(900);
  });

  it('형식이 다르면 null 이다', () => {
    expect(parseRunningEntities('')).toBeNull();
    expect(parseRunningEntities('nonsense')).toBeNull();
    // 앞의 세 필드가 모자란 경우 — 4번째를 잘못 집으면 안 된다.
    expect(parseRunningEntities('0.42 0.38 2/1234')).toBeNull();
  });
});
