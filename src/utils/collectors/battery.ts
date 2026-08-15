import { readdir } from 'fs/promises';

import { BatteryInfo } from '@/types/system';
import { readSys, withTtl } from '@/utils/collectors/shell';

// /sys/class/power_supply 의 배터리/UPS 를 읽는다. 라즈베리파이 UPS HAT,
// 노트북, USB UPS 등에서 채워지고, 없으면(대부분의 서버) null 이라 대시보드는
// N/A 로 남긴다. 충전율은 급히 변하지 않으니 조금 캐시한다.
//
// 전원 공급 장치는 Battery/UPS 외에 Mains(AC 어댑터)도 있어, type 이 Battery 이거나
// capacity 를 노출하는 것만 배터리로 취급한다.
export const getBatteryInfo = withTtl(15_000, async (): Promise<BatteryInfo | null> => {
  let entries: string[];
  try {
    entries = await readdir('/sys/class/power_supply');
  } catch {
    return null; // 리눅스 아님 또는 전원 클래스 없음
  }

  for (const name of entries) {
    const base = `/sys/class/power_supply/${name}`;
    const type = await readSys(`${base}/type`);
    if (type !== null && type !== 'Battery') continue;

    const capacityRaw = await readSys(`${base}/capacity`);
    if (capacityRaw === null) continue;
    const percentage = parseInt(capacityRaw, 10);
    if (Number.isNaN(percentage)) continue;

    const status = (await readSys(`${base}/status`)) ?? 'Unknown';
    return { percentage, status };
  }

  return null;
});
