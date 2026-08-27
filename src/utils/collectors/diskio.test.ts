import { describe, expect, it } from 'vitest';

import { parseDiskTotals } from '@/utils/collectors/diskio';

const SECTOR_BYTES = 512;

describe('parseDiskTotals', () => {
  it('sums whole disks and converts sectors to bytes', () => {
    // major minor name reads merged sectors_read ms writes merged sectors_written ...
    const contents = [
      '   8       0 sda 1000 0 20000 500 2000 0 40000 800 0 300 1300',
      '   8       1 sda1 900 0 18000 400 1500 0 30000 600 0 200 900', // partition: ignored
      '   7       0 loop0 5 0 100 1 0 0 0 0 0 0 0' // loop device: ignored
    ].join('\n');

    const totals = parseDiskTotals(contents);
    expect(totals.read).toBe(20000 * SECTOR_BYTES);
    expect(totals.write).toBe(40000 * SECTOR_BYTES);
  });

  it('sums across multiple whole disks', () => {
    const contents = [
      '   8       0 sda 0 0 10 0 0 0 20 0 0 0 0',
      ' 259       0 nvme0n1 0 0 30 0 0 0 40 0 0 0 0'
    ].join('\n');

    const totals = parseDiskTotals(contents);
    expect(totals.read).toBe((10 + 30) * SECTOR_BYTES);
    expect(totals.write).toBe((20 + 40) * SECTOR_BYTES);
  });

  it('throws when no whole-disk device is present', () => {
    expect(() => parseDiskTotals('   7       0 loop0 5 0 100 1 0 0 0 0 0 0 0')).toThrow();
  });
});
