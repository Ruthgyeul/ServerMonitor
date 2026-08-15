import { readdir } from 'fs/promises';

import { BatteryInfo } from '@/types/system';
import { readSys, withTtl } from '@/utils/collectors/shell';

// Reads the battery/UPS under /sys/class/power_supply. Populated on Raspberry
// Pi UPS HATs, laptops, USB UPSes, etc.; absent on most servers, where it
// stays null so the dashboard shows N/A. The charge level changes slowly, so
// cache it a little.
//
// Besides Battery/UPS the power-supply class also has Mains (AC adapters), so
// only treat entries whose type is Battery or that expose a capacity as batteries.
export const getBatteryInfo = withTtl(15_000, async (): Promise<BatteryInfo | null> => {
  let entries: string[];
  try {
    entries = await readdir('/sys/class/power_supply');
  } catch {
    return null; // not Linux, or no power-supply class
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
