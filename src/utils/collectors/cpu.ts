import { readFile } from 'fs/promises';

import { clamp, round } from '@/utils/collectors/shell';

interface CpuTimes {
  idle: number;
  total: number;
}

export interface CpuUsage {
  total: number;
  perCore: number[];
}

// `top -bn1` 의 첫 샘플은 부팅 이후 누적 평균이라 항상 0에 가깝게 나온다.
// /proc/stat 를 두 번 읽어 그 사이의 변화량으로 계산한다.
let previousSample: { total: CpuTimes; perCore: CpuTimes[] } | null = null;

function parseCpuLine(line: string): CpuTimes {
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 4 || values.some(Number.isNaN)) {
    throw new Error(`unparsable /proc/stat cpu line: ${line}`);
  }

  return {
    idle: values[3] + (values[4] ?? 0), // idle + iowait
    total: values.reduce((sum, value) => sum + value, 0)
  };
}

async function readCpuStat(): Promise<{ total: CpuTimes; perCore: CpuTimes[] }> {
  const contents = await readFile('/proc/stat', 'utf-8');
  const lines = contents.split('\n');

  const aggregate = lines.find(line => line.startsWith('cpu '));
  if (!aggregate) throw new Error('no "cpu" line in /proc/stat');

  // cpu0, cpu1, ... 은 논리 코어 순서대로 나온다.
  const perCore = lines.filter(line => /^cpu\d+ /.test(line)).map(parseCpuLine);
  return { total: parseCpuLine(aggregate), perCore };
}

function usageBetween(previous: CpuTimes, current: CpuTimes): number {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  return round(clamp((1 - idleDelta / totalDelta) * 100, 0, 100), 1);
}

export async function getCpuUsage(): Promise<CpuUsage> {
  let previous = previousSample;

  // 첫 호출이면 짧게 두 번 재서 0% 를 반환하지 않도록 한다.
  if (!previous) {
    previous = await readCpuStat();
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const current = await readCpuStat();
  previousSample = current;

  // 코어가 오프라인이 되면 개수가 달라질 수 있으므로 짧은 쪽에 맞춘다.
  const coreCount = Math.min(previous.perCore.length, current.perCore.length);
  const perCore = Array.from({ length: coreCount }, (_, index) =>
    usageBetween(previous.perCore[index], current.perCore[index])
  );

  return { total: usageBetween(previous.total, current.total), perCore };
}
