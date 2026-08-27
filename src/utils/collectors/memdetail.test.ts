import { describe, expect, it } from 'vitest';

import { parseMemBreakdown } from '@/utils/collectors/memdetail';

const MEMINFO = `MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          4096000 kB
SwapCached:        10240 kB
Shmem:            256000 kB
Slab:             786432 kB
`;

describe('parseMemBreakdown', () => {
  it('converts the relevant fields to MB', () => {
    const detail = parseMemBreakdown(MEMINFO);
    expect(detail.cached).toBe(4000);
    expect(detail.buffers).toBe(500);
    expect(detail.available).toBe(8000);
    expect(detail.shared).toBe(250);
    expect(detail.slab).toBe(768);
    expect(detail.swapCached).toBe(10);
  });

  it('returns null for missing fields', () => {
    expect(parseMemBreakdown('MemTotal: 1000 kB').cached).toBeNull();
  });
});
