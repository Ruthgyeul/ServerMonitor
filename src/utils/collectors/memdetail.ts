import { readFile } from 'fs/promises';

import { MemoryDetail } from '@/types/system';

// A finer breakdown of /proc/meminfo than the headline used/total: how much of
// "used" is reclaimable page cache vs. buffers vs. kernel slab, plus swap cached.
// Lets an operator tell real memory pressure from healthy cache usage. Pure
// parser split out for testing; the file is already read for the top-level gauge.

function field(contents: string, key: string): number | null {
  const match = contents.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
  return match ? parseInt(match[1], 10) : null;
}

const toMb = (kb: number | null): number | null => (kb === null ? null : Math.round(kb / 1024));

export function parseMemBreakdown(contents: string): MemoryDetail {
  return {
    cached: toMb(field(contents, 'Cached')),
    buffers: toMb(field(contents, 'Buffers')),
    available: toMb(field(contents, 'MemAvailable')),
    shared: toMb(field(contents, 'Shmem')),
    slab: toMb(field(contents, 'Slab')),
    swapCached: toMb(field(contents, 'SwapCached'))
  };
}

export async function getMemBreakdown(): Promise<MemoryDetail> {
  return parseMemBreakdown(await readFile('/proc/meminfo', 'utf-8'));
}
