import { DiskMount } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// A single `df -Pk` reads every mount, so servers with a separate data volume
// besides root (/) can see their real usage too. The parsing is split into a
// pure function so it can be tested.
//
// Keep only real block devices (first column starts with /dev/). Pseudo
// filesystems like tmpfs/devtmpfs/overlay/proc have meaningless or
// double-counted usage, so drop them.

const toGb = (kb: number) => round(kb / 1024 / 1024);

export function parseDf(stdout: string): DiskMount[] {
  const lines = stdout.split('\n').slice(1); // drop the header
  const byMount = new Map<string, DiskMount>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Filesystem  1024-blocks  Used  Available  Capacity  Mounted-on
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const source = parts[0];
    if (!source.startsWith('/dev/')) continue;

    const totalKb = parseInt(parts[1], 10);
    const usedKb = parseInt(parts[2], 10);
    const capacity = parseInt(parts[4].replace('%', ''), 10);
    // A mount path can contain spaces, so rejoin from the 6th field onward.
    const mount = parts.slice(5).join(' ');

    if (Number.isNaN(totalKb) || Number.isNaN(usedKb) || totalKb <= 0) continue;

    // If the same device appears twice (bind mounts, etc.) keep only the first (usually top-level) one.
    if (byMount.has(mount)) continue;

    byMount.set(mount, {
      mount,
      used: toGb(usedKb),
      total: toGb(totalKb),
      percentage: Number.isNaN(capacity) ? round((usedKb / totalKb) * 100, 1) : capacity
    });
  }

  // Root first, then the rest by descending usage.
  return [...byMount.values()].sort((a, b) => {
    if (a.mount === '/') return -1;
    if (b.mount === '/') return 1;
    return b.percentage - a.percentage;
  });
}
