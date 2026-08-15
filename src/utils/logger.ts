// Collects the scattered console.warn/error calls into one leveled logger.
// LOG_LEVEL tunes the volume (error < warn < info < debug). The default is
// info — collector-failure warnings show, verbose debug is hidden. A thin
// wrapper over console with no dependencies.

type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return raw in ORDER ? ORDER[raw as Level] : ORDER.info;
}

function emit(level: Level, args: unknown[]): void {
  if (ORDER[level] > threshold()) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
  // error/warn go to stderr, everything else to stdout via the matching console method.
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(prefix, ...args);
}

export const logger = {
  error: (...args: unknown[]) => emit('error', args),
  warn: (...args: unknown[]) => emit('warn', args),
  info: (...args: unknown[]) => emit('info', args),
  debug: (...args: unknown[]) => emit('debug', args)
};
