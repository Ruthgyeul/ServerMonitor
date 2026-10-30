import { ServerData } from '@/types/system';
import { getSystemInfo } from '@/utils/systemMonitor';
import { logger } from '@/utils/logger';
import { processSingleton } from '@/utils/processSingleton';

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
// nobody watching: save resources. Guard against a zero/negative/non-numeric
// override, which would otherwise make setTimeout fire immediately and spin the
// collectors in a tight loop while idle.
const IDLE_TICK_MS = (() => {
  const parsed = Number(process.env.IDLE_TICK_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
})();

// One loop per process, whichever bundle starts it (normally instrumentation
// at boot). Next bundles instrumentation separately from the route handlers,
// so without this each bundle ran its own loop with its own copy of every
// collector's state. The state lives on a process singleton and so does the
// starting bundle's collect function: routes that need a fresh sample call
// collectNow(), which runs the collection in the same module graph as the
// loop instead of a second one.
const state = processSingleton('systemStream', () => ({
  listeners: new Set<Listener>(),
  running: false,
  handle: null as ReturnType<typeof setTimeout> | null,
  lastData: null as ServerData | null,
  // Health of the loop itself, for /api/health.
  lastTickAt: 0,
  consecutiveFailures: 0,
  collect: getSystemInfo as () => Promise<ServerData>
}));
const { listeners } = state;

// A fresh sample from the loop's collector (cached for 1s there), for routes
// such as /api/system that answer a request directly.
export function collectNow(): Promise<ServerData> {
  return state.collect();
}

export interface LoopHealth {
  running: boolean;
  subscribers: number;
  lastTickAgeMs: number | null;
  consecutiveFailures: number;
}

export function getLoopHealth(): LoopHealth {
  return {
    running: state.running,
    subscribers: listeners.size,
    lastTickAgeMs: state.lastTickAt === 0 ? null : Date.now() - state.lastTickAt,
    consecutiveFailures: state.consecutiveFailures
  };
}

async function tick(): Promise<void> {
  try {
    const data = await state.collect();
    state.lastData = data;
    state.lastTickAt = Date.now();
    state.consecutiveFailures = 0;
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
    state.consecutiveFailures += 1;
    logger.error('system collection loop failed:', error);
  }
}

// "Schedule the next after completion" rather than setInterval, so requests
// don't pile up when collection takes longer than the interval. The interval
// is re-decided every tick based on whether there are subscribers.
async function loop(): Promise<void> {
  if (!state.running) return;
  await tick();
  if (!state.running) return;
  const interval = listeners.size > 0 ? ACTIVE_TICK_MS : IDLE_TICK_MS;
  state.handle = setTimeout(() => void loop(), interval);
  if (typeof state.handle.unref === 'function') state.handle.unref();
}

/**
 * Starts the collection loop if it isn't running. Called once at server boot
 * (instrumentation) and when the first subscriber attaches. Does nothing if
 * already running.
 */
export function ensureCollecting(): void {
  if (state.running) return;
  state.running = true;
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

  if (state.lastData) {
    try {
      listener(state.lastData);
    } catch (error) {
      logger.error('SSE listener threw on initial push:', error);
    }
  }

  return () => {
    listeners.delete(listener);
  };
}
