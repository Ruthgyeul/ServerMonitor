import os from 'os';
import { readFile } from 'fs/promises';

import { LoadInfo, SwapInfo } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// /proc/loadavg 는 "0.42 0.38 0.35 2/1234 5678" 꼴이다. 4번째 필드 앞쪽 숫자가
// 지금 실행 중이거나 실행 대기 중인 커널 엔티티 수 — 부하 평균의 순간값에 해당한다.
// os.loadavg() 로는 얻을 수 없어 파일을 직접 읽는다.
async function getRunningEntities(): Promise<number | null> {
  try {
    const contents = await readFile('/proc/loadavg', 'utf-8');
    const match = contents.match(/^\S+\s+\S+\s+\S+\s+(\d+)\/\d+/);
    if (!match) return null;
    const running = parseInt(match[1], 10);
    return Number.isFinite(running) ? running : null;
  } catch {
    // /proc 가 없는 OS(macOS 등)이거나 읽을 수 없다. 순간값만 비운다.
    return null;
  }
}

// 30분 이동평균은 뺀 나머지. 호출부가 현재 샘플을 기록한 뒤에 창을 읽어야
// 방금 값까지 반영되므로, 조립은 systemMonitor 가 맡는다.
export type LoadAverageBase = Omit<LoadInfo, 'avg30' | 'avg30WindowSeconds'>;

export async function getLoadAverage(): Promise<LoadAverageBase> {
  // os.loadavg() 는 /proc/loadavg 를 읽는 것과 같지만 파싱이 필요 없다.
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
    // 스왑이 없는 서버(총량 0)는 0% 로 둔다. 0/0 은 NaN 이 되어 UI 를 깨뜨린다.
    percentage: totalKb > 0 ? round((usedKb / totalKb) * 100, 1) : 0
  };
}
