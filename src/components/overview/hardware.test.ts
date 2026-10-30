import { describe, expect, it } from 'vitest';

import { formatDiskIo, tempColor } from '@/components/overview/HardwarePanels';
import { PALETTE } from '@/lib/theme';

describe('tempColor', () => {
  it('is green below clear, amber up to the alert threshold, red above', () => {
    expect(tempColor(55, 70, 74)).toBe(PALETTE.ok);
    expect(tempColor(72, 70, 74)).toBe(PALETTE.warn);
    expect(tempColor(80, 70, 74)).toBe(PALETTE.crit);
  });
});

describe('formatDiskIo', () => {
  it('reads the KB/s rates, falling back to MB/s', () => {
    expect(formatDiskIo({ read: 0, write: 0, readKBps: 3.24, writeKBps: 120 })).toEqual({
      read: '3.2',
      write: '120.0',
      unit: 'KB/s'
    });
    expect(formatDiskIo({ read: 0.5, write: 0 })).toEqual({ read: '512.0', write: '0.0', unit: 'KB/s' });
    expect(formatDiskIo({ read: 40, write: 2, readKBps: 40960, writeKBps: 2048 })).toEqual({
      read: '40.0',
      write: '2.0',
      unit: 'MB/s'
    });
  });
});
