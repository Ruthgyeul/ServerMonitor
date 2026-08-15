// 흩어져 있던 console.warn/error 를 레벨 있는 로거 하나로 모은다. LOG_LEVEL 로
// 출력량을 조절한다(error < warn < info < debug). 기본은 info — 수집기 실패
// 경고까지는 보이고, 상세 디버그는 감춘다. 의존성 없이 console 위에 얇게 얹는다.

type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return raw in ORDER ? ORDER[raw as Level] : ORDER.info;
}

function emit(level: Level, args: unknown[]): void {
  if (ORDER[level] > threshold()) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
  // error/warn 은 stderr, 나머지는 stdout 으로 나가도록 대응 console 메서드를 쓴다.
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(prefix, ...args);
}

export const logger = {
  error: (...args: unknown[]) => emit('error', args),
  warn: (...args: unknown[]) => emit('warn', args),
  info: (...args: unknown[]) => emit('info', args),
  debug: (...args: unknown[]) => emit('debug', args)
};
