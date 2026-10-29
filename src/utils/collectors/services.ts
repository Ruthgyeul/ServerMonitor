import { ServiceUnit, ServiceUnitList, ServicesInfo } from '@/types/system';
import { run, runArgs, withTtl } from '@/utils/collectors/shell';

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

// --- Full unit list (Services page) --------------------------------------

// systemd unit names: letters, digits and :-_.@\ (escaped instances). Anything
// else is rejected before it reaches a command line.
const UNIT_NAME = /^[A-Za-z0-9:_.@\\-]+\.service$/;

export function isServiceUnitName(name: string): boolean {
  return UNIT_NAME.test(name) && name.length <= 256;
}

// Pure: rows of `systemctl list-units --type=service --all --no-legend --plain`
// ("UNIT LOAD ACTIVE SUB DESCRIPTION…"). Units whose file is gone (not-found)
// are skipped — they are leftovers, not services.
export function parseUnitList(output: string): Omit<ServiceUnit, 'since'>[] {
  const units: Omit<ServiceUnit, 'since'>[] = [];
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [name, load, active, sub, ...description] = parts;
    if (!isServiceUnitName(name) || load === 'not-found') continue;
    units.push({ name, load, active, sub, description: description.join(' ') });
  }
  return units;
}

// Pure: `systemctl show --timestamp=unix -p Id,ActiveEnterTimestamp …` output
// (blank-line separated blocks) → unit → ISO time it last became active.
export function parseActiveSince(output: string): Map<string, string> {
  const since = new Map<string, string>();
  for (const block of output.split(/\n\s*\n/)) {
    let id: string | null = null;
    let stamp: string | null = null;
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=').trim();
      if (key === 'Id') id = value;
      if (key === 'ActiveEnterTimestamp') stamp = value;
    }
    if (!id || !stamp) continue;
    const seconds = stamp.startsWith('@') ? Number(stamp.slice(1)) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) since.set(id, new Date(seconds * 1000).toISOString());
  }
  return since;
}

export const listServiceUnits = withTtl(10_000, async (): Promise<ServiceUnitList> => {
  let listing: string;
  try {
    listing = await runArgs('systemctl', [
      'list-units',
      '--type=service',
      '--all',
      '--no-legend',
      '--plain',
      '--no-pager'
    ]);
  } catch {
    return { available: false, units: [] };
  }
  const units = parseUnitList(listing);

  let since = new Map<string, string>();
  if (units.length > 0) {
    try {
      const shown = await runArgs('systemctl', [
        'show',
        '--timestamp=unix',
        '-p',
        'Id,ActiveEnterTimestamp',
        '--',
        ...units.map(unit => unit.name)
      ]);
      since = parseActiveSince(shown);
    } catch {
      // Older systemd without --timestamp: list without "since" rather than fail.
    }
  }

  return { available: true, units: units.map(unit => ({ ...unit, since: since.get(unit.name) ?? null })) };
});
