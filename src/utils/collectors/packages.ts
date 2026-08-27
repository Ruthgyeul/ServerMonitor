import { PackagesInfo } from '@/types/system';
import { run, withTtl } from '@/utils/collectors/shell';

// Pending package updates, with a security subtotal — patch hygiene at a glance.
// Targets apt (the repo's stated Ubuntu focus): update-notifier's apt-check emits
// "total;security"; a plain `apt-get -s` simulation is the fallback. Checked
// infrequently (30 min) since it can touch package metadata.

// Pure: parse update-notifier apt-check output, "<total>;<security>".
export function parseAptCheck(output: string): PackagesInfo | null {
  const match = output.trim().match(/^(\d+);(\d+)$/);
  if (!match) return null;
  return { total: parseInt(match[1], 10), security: parseInt(match[2], 10) };
}

// Pure: count "Inst " lines in `apt-get -s upgrade` output, and of those the
// ones from a -security pocket.
export function parseAptSimulation(output: string): PackagesInfo {
  let total = 0;
  let security = 0;
  for (const line of output.split('\n')) {
    if (!line.startsWith('Inst ')) continue;
    total += 1;
    // Only the parenthesized repo/pocket annotation decides "security" — not the
    // package name (which might merely contain "security").
    const annotation = line.match(/\(([^)]*)\)/)?.[1] ?? '';
    if (/security/i.test(annotation)) security += 1;
  }
  return { total, security };
}

export const getPackagesInfo = withTtl(30 * 60_000, async (): Promise<PackagesInfo | null> => {
  // apt-check is fast and gives the security split directly.
  try {
    const output = await run('/usr/lib/update-notifier/apt-check 2>&1 || true', 10_000);
    const parsed = parseAptCheck(output);
    if (parsed) return parsed;
  } catch {
    // fall through to the simulation
  }

  try {
    // No `|| true`: if apt-get runs at all (throws only when absent), a fully
    // patched host has zero "Inst " lines and should report 0, not disappear.
    const output = await run('apt-get -s upgrade 2>/dev/null', 15_000);
    return parseAptSimulation(output);
  } catch {
    // apt not present
  }

  return null; // not a supported package manager, or nothing readable
});
