import { SmartDevice } from '@/types/system';
import { run, withTtl } from '@/utils/collectors/shell';

// Disk SMART health and per-drive temperature via smartctl. Surfaces impending
// hardware failure (a failing SMART self-assessment, reallocated sectors, high
// NVMe temperature) that no usage metric shows. Needs smartctl (smartmontools)
// and usually root; when absent or unreadable the list is simply empty. Cached
// for 5 minutes — it spawns one process per drive.

// Pure: parse `smartctl -j -H -A <dev>` JSON into a compact device summary.
export function parseSmartJson(raw: string, device: string): SmartDevice | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const status = json.smart_status as { passed?: unknown } | undefined;
  const temperature = json.temperature as { current?: unknown } | undefined;
  const powerOn = json.power_on_time as { hours?: unknown } | undefined;

  return {
    device,
    healthy: typeof status?.passed === 'boolean' ? status.passed : null,
    temperature: typeof temperature?.current === 'number' ? temperature.current : 'N/A',
    powerOnHours: typeof powerOn?.hours === 'number' ? powerOn.hours : null
  };
}

// Pure: device names from `smartctl --scan -j`.
export function parseSmartScan(raw: string): string[] {
  try {
    const json = JSON.parse(raw) as { devices?: { name?: unknown }[] };
    return (json.devices ?? [])
      .map(entry => entry.name)
      .filter((name): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

export const getSmartInfo = withTtl(5 * 60_000, async (): Promise<SmartDevice[]> => {
  let scan: string;
  try {
    scan = await run('smartctl --scan -j 2>/dev/null || true');
  } catch {
    return []; // smartctl not installed
  }

  const devices = parseSmartScan(scan).slice(0, 8); // bound the process fan-out
  const results = await Promise.all(
    devices.map(async device => {
      try {
        const raw = await run(`smartctl -j -H -A ${device} 2>/dev/null || true`, 8_000);
        return parseSmartJson(raw, device);
      } catch {
        return null;
      }
    })
  );

  return results.filter((entry): entry is SmartDevice => entry !== null);
});
