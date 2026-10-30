import { processSingleton } from '@/utils/processSingleton';

// Server-side memory for the cluster view: when each node last answered and
// its recent network rates, so the cards show "last seen 14m ago" and a
// network sparkline that survive a page reload. Pure helpers are exported for
// testing.

export const NET_POINTS = 30;
// Several viewers poll /api/cluster; keep at most one point per this interval.
const MIN_POINT_GAP_MS = 900;

export interface NetPoint {
  at: string; // ISO 8601
  down: number; // KB/s
  up: number; // KB/s
}

interface NodeMemory {
  lastOkAt: number | null;
  net: NetPoint[];
}

const state = processSingleton('clusterState', () => ({ nodes: new Map<string, NodeMemory>() }));

// Pure: a short, safe reason for a failed node request.
export function errorCode(error: unknown): string {
  const err = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'ETIMEDOUT';
  const code = err?.cause?.code ?? err?.code;
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return 'ETIMEDOUT';
  if (typeof code === 'string' && /^[A-Z_]{3,32}$/.test(code)) return code;
  return 'Connection failed';
}

// Pure: append a point (dropping it if too close to the last), keep the last NET_POINTS.
export function appendNet(history: NetPoint[], point: NetPoint): NetPoint[] {
  const last = history.at(-1);
  if (last && new Date(point.at).getTime() - new Date(last.at).getTime() < MIN_POINT_GAP_MS) return history;
  return [...history, point].slice(-NET_POINTS);
}

function memoryOf(name: string): NodeMemory {
  let memory = state.nodes.get(name);
  if (!memory) {
    memory = { lastOkAt: null, net: [] };
    state.nodes.set(name, memory);
  }
  return memory;
}

export function recordNodeOk(name: string, down: number, up: number, at: number = Date.now()): NodeMemory {
  const memory = memoryOf(name);
  memory.lastOkAt = at;
  memory.net = appendNet(memory.net, { at: new Date(at).toISOString(), down, up });
  return memory;
}

export function nodeMemory(name: string): NodeMemory {
  return memoryOf(name);
}
