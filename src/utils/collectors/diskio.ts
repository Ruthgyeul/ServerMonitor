import { readFile } from 'fs/promises';

import { DiskIoInfo } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// Counting partitions (sda1, nvme0n1p2) too would double-count the same I/O. Count whole disks only.
const WHOLE_DISK_PATTERN = /^(sd[a-z]+|nvme\d+n\d+|mmcblk\d+|vd[a-z]+|xvd[a-z]+|hd[a-z]+)$/;

// A /proc/diskstats sector is always 512 bytes, regardless of the device's physical sector size.
const SECTOR_BYTES = 512;

let previousSample: { read: number; write: number; at: number } | null = null;

async function readDiskTotals(): Promise<{ read: number; write: number }> {
  const contents = await readFile('/proc/diskstats', 'utf-8');

  let readSectors = 0;
  let writeSectors = 0;
  let matched = 0;

  for (const line of contents.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) continue;

    const name = fields[2];
    if (!WHOLE_DISK_PATTERN.test(name)) continue;

    const read = Number(fields[5]); // sectors read
    const written = Number(fields[9]); // sectors written
    if (Number.isNaN(read) || Number.isNaN(written)) continue;

    readSectors += read;
    writeSectors += written;
    matched += 1;
  }

  if (matched === 0) throw new Error('no whole-disk devices found in /proc/diskstats');
  return { read: readSectors * SECTOR_BYTES, write: writeSectors * SECTOR_BYTES };
}

export async function getDiskIo(): Promise<DiskIoInfo> {
  const totals = await readDiskTotals();
  const now = Date.now();
  const previous = previousSample;
  previousSample = { ...totals, at: now };

  // The first sample has nothing to compare against. Using cumulative bytes as-is would look like hundreds of MB/s.
  if (!previous) return { read: 0, write: 0 };

  const elapsedSeconds = (now - previous.at) / 1000;
  if (elapsedSeconds <= 0) return { read: 0, write: 0 };

  const rate = (current: number, before: number) =>
    round(Math.max(0, current - before) / 1024 / 1024 / elapsedSeconds, 1);

  return { read: rate(totals.read, previous.read), write: rate(totals.write, previous.write) };
}
