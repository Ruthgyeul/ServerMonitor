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
  // iowait: I/O wait ratio, a disk-bottleneck signal. steal: time taken by the
  // hypervisor, a VPS-oversubscription signal. On an OS without /proc/stat both
  // are 0/meaningless.
  iowait: number;
  steal: number;
  // Average current clock of the logical cores (MHz). 'N/A' when cpufreq is absent.
  frequencyMhz: number | 'N/A';
}

// The first `top -bn1` sample is the average since boot, so it's always near 0.
// Read /proc/stat twice and compute from the delta between them.
let previousSample: { total: CpuTimes; perCore: CpuTimes[] } | null = null;

// /proc/stat cpu fields: user nice system idle iowait irq softirq steal ...
export function parseCpuLine(line: string): CpuTimes {
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 4 || values.some(Number.isNaN)) {
    throw new Error(`unparsable /proc/stat cpu line: ${line}`);
  }

  const iowait = values[4] ?? 0;
  const steal = values[7] ?? 0;
  return {
    idle: values[3] + iowait, // idle + iowait is "time not working"
    iowait,
    steal,
    total: values.reduce((sum, value) => sum + value, 0)
  };
}

// Averages each core's current operating frequency (kHz) and returns it in MHz.
// On an environment without a cpufreq governor (virtualization, etc.) the file
// is missing, so 'N/A'.
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

  // cpu0, cpu1, ... come out in logical-core order.
  const perCore = lines.filter(line => /^cpu\d+ /.test(line)).map(parseCpuLine);
  return { total: parseCpuLine(aggregate), perCore };
}

function usageBetween(previous: CpuTimes, current: CpuTimes): number {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  return round(clamp((1 - idleDelta / totalDelta) * 100, 0, 100), 1);
}

type CpuSample = { total: CpuTimes; perCore: CpuTimes[] };

// Pure: derive usage from two /proc/stat samples. Separated from the reads and
// the cpufreq lookup so the delta maths can be unit-tested with fixed jiffies.
export function computeCpuUsage(previous: CpuSample, current: CpuSample): Omit<CpuUsage, 'frequencyMhz'> {
  // The core count can change if a core goes offline, so use the shorter one.
  const coreCount = Math.min(previous.perCore.length, current.perCore.length);
  const perCore = Array.from({ length: coreCount }, (_, index) =>
    usageBetween(previous.perCore[index], current.perCore[index])
  );

  // iowait/steal as a ratio (%) of total time. If the delta is 0 (first sample, etc.), 0.
  const totalDelta = current.total.total - previous.total.total;
  const share = (deltaField: number) =>
    totalDelta > 0 ? round(clamp((deltaField / totalDelta) * 100, 0, 100), 1) : 0;

  return {
    total: usageBetween(previous.total, current.total),
    perCore,
    iowait: share(current.total.iowait - previous.total.iowait),
    steal: share(current.total.steal - previous.total.steal)
  };
}

export async function getCpuUsage(): Promise<CpuUsage> {
  let previous = previousSample;

  // On the first call, take two quick samples so we don't return 0%.
  if (!previous) {
    previous = await readCpuStat();
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const [current, frequencyMhz] = await Promise.all([readCpuStat(), readFrequencyMhz()]);
  previousSample = current;

  return { ...computeCpuUsage(previous, current), frequencyMhz };
}
