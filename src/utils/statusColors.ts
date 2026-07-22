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
export function loadColor(load: number, cores: number): string {
  const perCore = cores > 0 ? load / cores : load;
  if (perCore < 0.7) return '#4ade80';
  if (perCore < 1) return '#facc15';
  return '#f87171';
}

// GitHub 잔디와 같은 4단계. 값이 없는 구간은 배경색으로 비워 둔다.
export function loadCellColor(load: number | null, cores: number): string {
  if (load === null) return COLORS.empty;
  const perCore = cores > 0 ? load / cores : load;
  if (perCore < 0.3) return '#0e4429';
  if (perCore < 0.6) return '#006d32';
  if (perCore < 0.9) return '#26a641';
  return '#39d353';
}

export const ALERT_LEVEL_COLORS: Record<string, string> = {
  ok: '#4ade80',
  info: '#60a5fa',
  warning: '#facc15',
  critical: '#f87171'
};
