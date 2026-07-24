// 대시보드 전체가 같은 기준으로 색을 고르도록 한곳에 모아둔다.

export const COLORS = {
  ok: '#10b981',
  warn: '#f59e0b',
  critical: '#ef4444',
  idle: '#374151',
  empty: '#111827',
  muted: '#6b7280'
} as const;

export function statusColor(percentage: number): string {
  if (percentage < 50) return COLORS.ok;
  if (percentage < 80) return COLORS.warn;
  return COLORS.critical;
}

export function tempColor(temperature: number | 'N/A'): string {
  if (temperature === 'N/A') return '#9ca3af';
  if (temperature <= 50) return '#4ade80';
  if (temperature <= 65) return '#facc15';
  if (temperature <= 74) return '#fb923c';
  return '#f87171';
}

// 로드는 코어 수로 나눠야 의미가 있다. 4코어의 4.0 과 1코어의 4.0 은 다르다.
// 격자와 같은 그라데이션을 쓰되, 글자라서 어두운 쪽 끝은 잘라 가독성을 지킨다.
export function loadColor(load: number, cores: number): string {
  const perCore = cores > 0 ? load / cores : load;
  return heatColor(Math.max(TEXT_HEAT_FLOOR, perCore));
}

// 부하가 낮으면 초록, 높아질수록 노랑 → 주황 → 빨강으로 이어지는 연속 그라데이션.
// 단계식으로 끊으면 0.59 와 0.61 이 완전히 다른 색이 되어 추세가 안 보인다.
const HEAT_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [14, 68, 41]], // 거의 유휴 — 어두운 초록
  [0.35, [38, 166, 65]],
  [0.6, [250, 204, 21]],
  [0.8, [249, 115, 22]],
  [1, [239, 68, 68]] // 포화 — 빨강
];

// 어두운 배경 위 글자에는 그라데이션의 제일 어두운 초록이 너무 안 읽힌다.
const TEXT_HEAT_FLOOR = 0.35;

// ratio 는 0(유휴)~1(포화)로 정규화된 부하. 범위를 벗어나면 양 끝 색으로 고정된다.
export function heatColor(ratio: number): string {
  // NaN 이 들어오면 clamp 를 통과해 rgb(NaN,…) 가 되므로 먼저 막는다.
  if (!Number.isFinite(ratio)) return COLORS.muted;
  const t = Math.min(1, Math.max(0, ratio));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [prevAt, prev] = HEAT_STOPS[i - 1];
    const [nextAt, next] = HEAT_STOPS[i];
    if (t > nextAt) continue;
    const span = nextAt - prevAt;
    const k = span > 0 ? (t - prevAt) / span : 0;
    const channels = prev.map((value, index) => Math.round(value + (next[index] - value) * k));
    return `rgb(${channels.join(', ')})`;
  }
  return COLORS.critical;
}

// 값이 없는 구간은 배경색으로 비워 둔다. 코어당 로드 1.0 을 포화로 본다.
export function loadCellColor(load: number | null, cores: number): string {
  if (load === null) return COLORS.empty;
  const perCore = cores > 0 ? load / cores : load;
  return heatColor(perCore);
}

export const ALERT_LEVEL_COLORS: Record<string, string> = {
  ok: '#4ade80',
  info: '#60a5fa',
  warning: '#facc15',
  critical: '#f87171'
};
