import os from 'os';
import { readFile } from 'fs/promises';

import { LoadInfo, SwapInfo } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// /proc/loadavg looks like "0.42 0.38 0.35 2/1234 5678". The number before the
// slash in the 4th field is the count of kernel entities running or waiting to
// run right now — the instantaneous counterpart of the load average.
// os.loadavg() can't give it, so read the file directly.
export function parseRunningEntities(contents: string): number | null {
  const match = contents.match(/^\S+\s+\S+\s+\S+\s+(\d+)\/\d+/);
  if (!match) return null;
  const running = parseInt(match[1], 10);
  return Number.isFinite(running) ? running : null;
}

async function getRunningEntities(): Promise<number | null> {
  try {
    return parseRunningEntities(await readFile('/proc/loadavg', 'utf-8'));
  } catch {
    // OS without /proc (macOS, etc.) or unreadable. Leave only the instantaneous value empty.
    return null;
  }
}

// Everything except the 30-minute moving average. The caller must read the
// window after recording the current sample so it reflects the latest value,
// so systemMonitor does the assembly.
export type LoadAverageBase = Omit<LoadInfo, 'avg30' | 'avg30WindowSeconds'>;

export async function getLoadAverage(): Promise<LoadAverageBase> {
  // os.loadavg() is the same as reading /proc/loadavg but needs no parsing.
  const [avg1, avg5, avg15] = os.loadavg();
  return {
    avg1: round(avg1),
    avg5: round(avg5),
    avg15: round(avg15),
    running: await getRunningEntities()
  };
}

export async function getSwapInfo(): Promise<SwapInfo> {
  const contents = await readFile('/proc/meminfo', 'utf-8');
  const field = (key: string) => {
    const match = contents.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
    return match ? parseInt(match[1], 10) : null;
  };

  const totalKb = field('SwapTotal');
  if (totalKb === null) throw new Error('SwapTotal missing from /proc/meminfo');

  const freeKb = field('SwapFree') ?? 0;
  const usedKb = Math.max(0, totalKb - freeKb);
  const toGb = (kb: number) => round(kb / 1024 / 1024);

  return {
    used: toGb(usedKb),
    total: toGb(totalKb),
    // A server with no swap (total 0) stays at 0%. 0/0 would be NaN and break the UI.
    percentage: totalKb > 0 ? round((usedKb / totalKb) * 100, 1) : 0
  };
}
