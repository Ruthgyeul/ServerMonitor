// 루트 디스크 사용률의 최근 추세로 "이 속도면 언제 가득 차는가" 를 추정한다.
// 히스토리 버킷(load/cpu)과 달리 라이브 추정이라 디스크에 남기지 않는다 —
// 재시작하면 창이 다시 차오른다. 예측이 목적이라 그걸로 충분하다.

export interface DiskSample {
  at: number;
  percent: number;
}

// 창 안의 첫/끝 샘플로 선형 증가율을 내, 100% 까지 남은 시간을 시간 단위로 준다.
// 채워질 만큼 오르고 있지 않으면(감소/정체) null — "곧 가득 참" 이 아닐 때 숫자를
// 억지로 만들지 않는다.
export function predictHoursToFull(samples: DiskSample[], at: number): number | null {
  if (samples.length < 2) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const spanHours = (last.at - first.at) / 3_600_000;
  if (spanHours <= 0) return null;

  const ratePerHour = (last.percent - first.percent) / spanHours;
  // 시간당 0.1%p 미만 증가는 노이즈로 보고 예측하지 않는다(먼 미래의 헛수).
  if (ratePerHour < 0.1) return null;

  const remaining = 100 - last.percent;
  if (remaining <= 0) return 0;

  void at;
  return Math.round((remaining / ratePerHour) * 10) / 10;
}

const WINDOW_MS = 6 * 60 * 60 * 1000; // 최근 6시간의 추세만 본다
const samples: DiskSample[] = [];

export function recordDiskSample(percent: number, at: number = Date.now()): void {
  samples.push({ at, percent });
  const oldest = at - WINDOW_MS;
  let drop = 0;
  while (drop < samples.length && samples[drop].at < oldest) drop += 1;
  if (drop > 0) samples.splice(0, drop);
}

export function getHoursToFull(at: number = Date.now()): number | null {
  return predictHoursToFull(samples, at);
}
