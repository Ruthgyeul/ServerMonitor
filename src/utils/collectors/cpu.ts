import { readFile, readdir } from 'fs/promises';

import { clamp, readSys, round } from '@/utils/collectors/shell';

interface CpuTimes {
  idle: number;
  iowait: number;
  steal: number;
  total: number;
}

export interface CpuUsage {
  total: number;
  perCore: number[];
  // I/O 대기 비율: 디스크 병목 신호. steal: 하이퍼바이저에 뺏긴 시간으로 VPS
  // 과판매 신호. /proc/stat 를 못 읽는 OS 에서는 각각 0/무의미.
  iowait: number;
  steal: number;
  // 논리 코어들의 현재 클럭 평균(MHz). cpufreq 가 없으면 'N/A'.
  frequencyMhz: number | 'N/A';
}

// `top -bn1` 의 첫 샘플은 부팅 이후 누적 평균이라 항상 0에 가깝게 나온다.
// /proc/stat 를 두 번 읽어 그 사이의 변화량으로 계산한다.
let previousSample: { total: CpuTimes; perCore: CpuTimes[] } | null = null;

// /proc/stat cpu 필드: user nice system idle iowait irq softirq steal ...
function parseCpuLine(line: string): CpuTimes {
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 4 || values.some(Number.isNaN)) {
    throw new Error(`unparsable /proc/stat cpu line: ${line}`);
  }

  const iowait = values[4] ?? 0;
  const steal = values[7] ?? 0;
  return {
    idle: values[3] + iowait, // idle + iowait 는 "일 안 한 시간"
    iowait,
    steal,
    total: values.reduce((sum, value) => sum + value, 0)
  };
}

// 각 코어의 현재 동작 주파수(kHz)를 평균내 MHz 로 돌려준다. cpufreq 거버너가
// 없는 환경(가상화 등)에서는 파일이 없어 'N/A'.
async function readFrequencyMhz(): Promise<number | 'N/A'> {
  let cpus: string[];
  try {
    cpus = (await readdir('/sys/devices/system/cpu')).filter(name => /^cpu\d+$/.test(name));
  } catch {
    return 'N/A';
  }

  let sumKhz = 0;
  let count = 0;
  for (const cpu of cpus) {
    const raw = await readSys(`/sys/devices/system/cpu/${cpu}/cpufreq/scaling_cur_freq`);
    if (raw === null) continue;
    const khz = parseInt(raw, 10);
    if (!Number.isNaN(khz)) {
      sumKhz += khz;
      count += 1;
    }
  }

  return count === 0 ? 'N/A' : round(sumKhz / count / 1000, 0);
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

  const [current, frequencyMhz] = await Promise.all([readCpuStat(), readFrequencyMhz()]);
  previousSample = current;

  // 코어가 오프라인이 되면 개수가 달라질 수 있으므로 짧은 쪽에 맞춘다.
  const coreCount = Math.min(previous.perCore.length, current.perCore.length);
  const perCore = Array.from({ length: coreCount }, (_, index) =>
    usageBetween(previous.perCore[index], current.perCore[index])
  );

  // iowait/steal 은 전체 시간 대비 비율(%)로. 델타가 0이면(첫 샘플 등) 0.
  const totalDelta = current.total.total - previous.total.total;
  const share = (deltaField: number) =>
    totalDelta > 0 ? round(clamp((deltaField / totalDelta) * 100, 0, 100), 1) : 0;

  return {
    total: usageBetween(previous.total, current.total),
    perCore,
    iowait: share(current.total.iowait - previous.total.iowait),
    steal: share(current.total.steal - previous.total.steal),
    frequencyMhz
  };
}
