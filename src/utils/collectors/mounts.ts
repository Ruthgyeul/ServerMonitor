import { readFile } from 'fs/promises';

import { ReadOnlyMount } from '@/types/system';

// Detects filesystems that have flipped to read-only — a classic silent failure
// mode (a disk error makes the kernel remount ro, and writes start failing while
// everything else looks fine). We read /proc/mounts and report real block-device
// mounts whose options include `ro`. Pseudo filesystems and legitimately
// read-only mounts (squashfs, iso9660, overlay lowerdirs) are excluded.

const PSEUDO_FS = new Set([
  'proc',
  'sysfs',
  'tmpfs',
  'devtmpfs',
  'devpts',
  'cgroup',
  'cgroup2',
  'securityfs',
  'debugfs',
  'tracefs',
  'mqueue',
  'hugetlbfs',
  'pstore',
  'bpf',
  'configfs',
  'fusectl',
  'autofs',
  'binfmt_misc',
  'squashfs',
  'iso9660',
  'overlay'
]);

// Pure parser for /proc/mounts (or the output of `mount`), returning real
// filesystems currently mounted read-only.
export function parseReadOnlyMounts(contents: string): ReadOnlyMount[] {
  const found: ReadOnlyMount[] = [];
  for (const line of contents.split('\n')) {
    // device mountpoint fstype options dump pass
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;

    const [device, mount, fstype, options] = parts;
    if (PSEUDO_FS.has(fstype)) continue;
    if (!device.startsWith('/dev/')) continue;

    const flags = options.split(',');
    if (flags.includes('ro') && !flags.includes('rw')) {
      found.push({ mount, device, fstype });
    }
  }
  return found;
}

export async function getReadOnlyMounts(): Promise<ReadOnlyMount[]> {
  return parseReadOnlyMounts(await readFile('/proc/mounts', 'utf-8'));
}
