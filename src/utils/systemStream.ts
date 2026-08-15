import { ServerData } from '@/types/system';
import { getSystemInfo } from '@/utils/systemMonitor';
import { logger } from '@/utils/logger';

// Instead of running the collectors per request, run exactly one loop in the
// process. No matter how many clients connect, the shell spawns
// (sensors/ping/ps/df ...) happen once, and each SSE connection just shares the result.
//
// The loop does not stop when there are no subscribers. Even with nobody
// watching, the history (48/24-hour graphs) and threshold alerts must keep
// accumulating ("24/7 collection"). When no one is watching, though, the tick
// interval is widened to reduce load — the history buckets are hourly, so
// there's no reason to sample idle stretches densely.

type Listener = (data: ServerData) => void;

const ACTIVE_TICK_MS = 1000; // someone is watching: real-time
const IDLE_TICK_MS = Number(process.env.IDLE_TICK_MS) || 15000; // nobody watching: save resources

const listeners = new Set<Listener>();
let running = false;
let handle: ReturnType<typeof setTimeout> | null = null;
let lastData: ServerData | null = null;

// Health of the collection loop itself. /api/health reads this so a
// scheduler/monitor can detect a stalled or continuously-failing loop.
let lastTickAt = 0;
let consecutiveFailures = 0;

export interface LoopHealth {
  running: boolean;
  subscribers: number;
  lastTickAgeMs: number | null;
  consecutiveFailures: number;
}

export function getLoopHealth(): LoopHealth {
  return {
    running,
    subscribers: listeners.size,
    lastTickAgeMs: lastTickAt === 0 ? null : Date.now() - lastTickAt,
    consecutiveFailures
  };
}

async function tick(): Promise<void> {
  try {
    const data = await getSystemInfo();
    lastData = data;
    lastTickAt = Date.now();
    consecutiveFailures = 0;
    for (const listener of listeners) {
      // Isolate each subscriber so one's exception doesn't spread to the others.
      try {
        listener(data);
      } catch (error) {
        logger.error('SSE listener threw:', error);
      }
    }
  } catch (error) {
    // Keep the loop alive even if collection itself fails. Skip just this tick;
    // subscribers keep holding the last value they received.
    consecutiveFailures += 1;
    logger.error('system collection loop failed:', error);
  }
}

// "Schedule the next after completion" rather than setInterval, so requests
// don't pile up when collection takes longer than the interval. The interval
// is re-decided every tick based on whether there are subscribers.
async function loop(): Promise<void> {
  if (!running) return;
  await tick();
  if (!running) return;
  const interval = listeners.size > 0 ? ACTIVE_TICK_MS : IDLE_TICK_MS;
  handle = setTimeout(() => void loop(), interval);
  if (handle && typeof handle.unref === 'function') handle.unref();
}

/**
 * Starts the collection loop if it isn't running. Called once at server boot
 * (instrumentation) and when the first subscriber attaches. Does nothing if
 * already running.
 */
export function ensureCollecting(): void {
  if (running) return;
  running = true;
  void loop();
}

/**
 * Subscribes to system-data updates. On subscribe it delivers the last
 * snapshot once (if any), so a new connection doesn't wait for the next tick.
 * Call the returned function to unsubscribe. The loop keeps running even after
 * the last subscriber leaves (24/7).
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  ensureCollecting();

  if (lastData) {
    try {
      listener(lastData);
    } catch (error) {
      logger.error('SSE listener threw on initial push:', error);
    }
  }

  return () => {
    listeners.delete(listener);
  };
}
