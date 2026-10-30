import type { NetworkHistoryEntry, ServerData } from '@/types/system';
import { formatAge } from '@/utils/timeFormat';

// The per-node shape /api/cluster returns. No IP, only a display host label.
export type NodeResult = { ok: true; data: ServerData } | { ok: false; error: string };

export interface ClusterNode {
  name: string;
  host: string;
  type: 'intel' | 'rpi';
  result: NodeResult;
  // Added for the redesigned cluster view (optional: older dashboards omit them).
  rttMs?: number | null; // dashboard → node round trip
  lastOkAt?: string | null; // when the node last answered
  net?: { at: string; down: number; up: number }[]; // recent KB/s, oldest first
}

export function formatUptime(uptime: ServerData['uptime']): string {
  const { days, hours, minutes } = uptime;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// `comm` is usually just the executable name, but some nodes mix in a
// path/args, so keep only the basename of the first token.
export function shortProcessName(name: string): string {
  return name.split(' ')[0].split('/').pop() ?? name;
}

// Memory arrives in MB, disk in GB; captions read "1.4/4.0G".
export const gb = (mb: number) => (mb / 1024).toFixed(1);

// Ping as the dashboard sees it: its own round trip to the node, falling back
// to the node's outbound ping reading for older servers.
export function pingText(node: ClusterNode): string {
  if (typeof node.rttMs === 'number') return `${node.rttMs} ms`;
  const ping = node.result.ok ? node.result.data.network.ping : 0;
  return ping > 0 ? `${ping.toFixed(0)} ms` : '—';
}

// Offline line: "ETIMEDOUT · last seen 14m ago" when the node answered before.
export function offlineReason(node: ClusterNode, now: number | null): string {
  const error = node.result.ok ? '' : node.result.error;
  if (!node.lastOkAt || now === null) return error;
  const age = formatAge(now - new Date(node.lastOkAt).getTime());
  return `${error} · last seen ${age === 'now' ? 'just now' : `${age} ago`}`;
}

// The 30-second throughput window: the server's ring buffer when it sends one
// (survives a page reload), otherwise what this page has polled itself.
export function netHistory(node: ClusterNode, polled: NetworkHistoryEntry[]): NetworkHistoryEntry[] {
  if (!node.net || node.net.length === 0) return polled;
  return node.net.map(point => ({ time: point.at, download: point.down, upload: point.up }));
}
