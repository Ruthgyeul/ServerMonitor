import type { ServerData } from '@/types/system';

// The per-node shape /api/cluster returns. No IP, only a display host label.
export type NodeResult = { ok: true; data: ServerData } | { ok: false; error: string };

export interface ClusterNode {
  name: string;
  host: string;
  type: 'intel' | 'rpi';
  result: NodeResult;
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
