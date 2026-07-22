import { readdir } from 'fs/promises';

import { GpuInfo } from '@/types/system';
import { clamp, readSys, round, run, withTtl } from '@/utils/collectors/shell';

const UNAVAILABLE: GpuInfo = { name: null, usage: 'N/A', temperature: 'N/A' };

// amdgpu 는 사용률을 sysfs 로 그대로 노출한다. 외부 명령이 필요 없다.
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

// nvidia-smi 는 프로세스를 띄우고 200ms 가까이 걸린다. 매 초 호출하지 않는다.
const readNvidiaGpu = withTtl(5000, async (): Promise<GpuInfo | null> => {
  let output: string;
  try {
    output = await run(
      'nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu --format=csv,noheader,nounits'
    );
  } catch {
    return null; // 드라이버/도구 미설치
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
  // 인텔 내장 그래픽은 커널이 사용률을 퍼센트로 노출하지 않아
  // (i915 는 perf 이벤트로만 얻을 수 있다) N/A 로 남는다.
  return (await readAmdGpu()) ?? (await readNvidiaGpu()) ?? UNAVAILABLE;
}
