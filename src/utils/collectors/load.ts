import os from 'os';
import { readFile } from 'fs/promises';

import { LoadInfo, SwapInfo } from '@/types/system';
import { round } from '@/utils/collectors/shell';

export function getLoadAverage(): LoadInfo {
  // os.loadavg() 는 /proc/loadavg 를 읽는 것과 같지만 파싱이 필요 없다.
  const [avg1, avg5, avg15] = os.loadavg();
  return { avg1: round(avg1), avg5: round(avg5), avg15: round(avg15) };
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
    // 스왑이 없는 서버(총량 0)는 0% 로 둔다. 0/0 은 NaN 이 되어 UI 를 깨뜨린다.
    percentage: totalKb > 0 ? round((usedKb / totalKb) * 100, 1) : 0
  };
}
