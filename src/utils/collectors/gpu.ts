import { readdir } from 'fs/promises';

import { GpuInfo } from '@/types/system';
import { clamp, readSys, round, run, withTtl } from '@/utils/collectors/shell';

const UNAVAILABLE: GpuInfo = { name: null, usage: 'N/A', temperature: 'N/A' };

// amdgpu exposes utilization directly via sysfs. No external command needed.
async function readAmdGpu(): Promise<GpuInfo | null> {
  let cards: string[];
  try {
    cards = (await readdir('/sys/class/drm')).filter(name => /^card\d+$/.test(name));
  } catch {
    return null;
  }

  for (const card of cards) {
    const busy = await readSys(`/sys/class/drm/${card}/device/gpu_busy_percent`);
    if (busy === null) continue;

    const usage = parseInt(busy, 10);
    if (Number.isNaN(usage)) continue;

    return {
      name: (await readSys(`/sys/class/drm/${card}/device/label`)) ?? 'amdgpu',
      usage: clamp(usage, 0, 100),
      temperature: await readAmdTemperature(card)
    };
  }

  return null;
}

async function readAmdTemperature(card: string): Promise<number | 'N/A'> {
  const base = `/sys/class/drm/${card}/device/hwmon`;
  let hwmons: string[];
  try {
    hwmons = await readdir(base);
  } catch {
    return 'N/A';
  }

  for (const hwmon of hwmons) {
    const raw = await readSys(`${base}/${hwmon}/temp1_input`);
    if (raw === null) continue;
    const milliCelsius = parseInt(raw, 10);
    if (!Number.isNaN(milliCelsius)) return round(milliCelsius / 1000, 1);
  }
  return 'N/A';
}

// nvidia-smi spawns a process and takes close to 200ms. Don't call it every second.
const readNvidiaGpu = withTtl(5000, async (): Promise<GpuInfo | null> => {
  let output: string;
  try {
    output = await run(
      'nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu --format=csv,noheader,nounits'
    );
  } catch {
    return null; // driver/tool not installed
  }

  const [line] = output.split('\n');
  if (!line) return null;

  const [name, usage, temperature] = line.split(',').map(value => value.trim());
  const usageValue = parseFloat(usage);
  const temperatureValue = parseFloat(temperature);

  return {
    name: name || 'NVIDIA',
    usage: Number.isNaN(usageValue) ? 'N/A' : clamp(usageValue, 0, 100),
    temperature: Number.isNaN(temperatureValue) ? 'N/A' : temperatureValue
  };
});

export async function getGpuInfo(): Promise<GpuInfo> {
  // Intel integrated graphics leaves N/A: the kernel doesn't expose utilization
  // as a percentage (i915 only offers it via perf events).
  return (await readAmdGpu()) ?? (await readNvidiaGpu()) ?? UNAVAILABLE;
}
