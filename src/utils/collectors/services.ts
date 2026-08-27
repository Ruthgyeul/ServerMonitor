import { ServicesInfo } from '@/types/system';
import { run, withTtl } from '@/utils/collectors/shell';

// Failed systemd units — a direct "is anything broken" signal that the
// process/CPU views miss (a crashed service shows nothing on a load graph).
// Parsed from `systemctl --failed`. Pure parser split out for testing.

// Pure: extract failed unit names from `systemctl list-units --failed
// --no-legend --plain` output. Each row starts with the unit name.
export function parseFailedUnits(output: string): string[] {
  const units: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Stop at the summary footer ("N loaded units listed." / "0 loaded units...").
    if (/loaded units? listed/i.test(trimmed) || /^\d+ unit/i.test(trimmed)) continue;
    const name = trimmed.split(/\s+/)[0];
    if (name && name.endsWith('.service')) units.push(name);
  }
  return units;
}

export const getServicesInfo = withTtl(30_000, async (): Promise<ServicesInfo> => {
  let output: string;
  try {
    // No `|| true`: on a non-systemd host (or one where systemctl can't reach the
    // manager) the command fails and we return null (unknown), rather than
    // presenting an unavailable check as a healthy "0 failed". A real 0-failure
    // run exits 0 with empty output.
    output = await run('systemctl list-units --type=service --state=failed --no-legend --plain 2>/dev/null');
  } catch {
    return { failed: null, failedUnits: [] };
  }

  // Count the full set; only the detail list is bounded.
  const units = parseFailedUnits(output);
  return { failed: units.length, failedUnits: units.slice(0, 10) };
});
