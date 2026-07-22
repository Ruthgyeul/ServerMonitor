import { readFile } from 'fs/promises';

import { DiskIoInfo } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// 파티션(sda1, nvme0n1p2)까지 세면 같은 I/O 를 두 번 더하게 된다. 전체 디스크만 센다.
const WHOLE_DISK_PATTERN = /^(sd[a-z]+|nvme\d+n\d+|mmcblk\d+|vd[a-z]+|xvd[a-z]+|hd[a-z]+)$/;

// /proc/diskstats 의 섹터는 장치의 물리 섹터 크기와 무관하게 항상 512 바이트다.
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

    const read = Number(fields[5]);  // sectors read
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

  // 첫 샘플은 비교 대상이 없다. 누적 바이트를 그대로 쓰면 수백 MB/s 로 보인다.
  if (!previous) return { read: 0, write: 0 };

  const elapsedSeconds = (now - previous.at) / 1000;
  if (elapsedSeconds <= 0) return { read: 0, write: 0 };

  const rate = (current: number, before: number) =>
    round(Math.max(0, current - before) / 1024 / 1024 / elapsedSeconds, 1);

  return { read: rate(totals.read, previous.read), write: rate(totals.write, previous.write) };
}
