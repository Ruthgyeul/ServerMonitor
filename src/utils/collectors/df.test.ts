import { describe, expect, it } from 'vitest';

import { parseDf } from '@/utils/collectors/df';

// Example `df -Pk` output. Header + real block devices + pseudo filesystems mixed together.
const SAMPLE = `Filesystem     1024-blocks      Used  Available Capacity Mounted on
udev              8123456         0    8123456       0% /dev
tmpfs             1638400      2048    1636352       1% /run
/dev/sda1        50000000  25000000   25000000      50% /
/dev/sdb1       200000000  20000000  180000000      10% /data
overlay          50000000  25000000   25000000      50% /var/lib/docker/overlay2/abc
/dev/sda1        50000000  25000000   25000000      50% /`;

describe('parseDf', () => {
  it('keeps only real block devices (/dev/*) and drops pseudo filesystems', () => {
    const disks = parseDf(SAMPLE);
    const mounts = disks.map(d => d.mount);
    expect(mounts).toContain('/');
    expect(mounts).toContain('/data');
    expect(mounts).not.toContain('/run'); // tmpfs
    expect(mounts).not.toContain('/dev'); // udev
    expect(mounts.some(m => m.includes('overlay'))).toBe(false);
  });

  it('counts a duplicate mount only once', () => {
    const roots = parseDf(SAMPLE).filter(d => d.mount === '/');
    expect(roots).toHaveLength(1);
  });

  it('puts root first and computes GB/percentage', () => {
    const disks = parseDf(SAMPLE);
    expect(disks[0].mount).toBe('/');
    expect(disks[0].percentage).toBe(50);
    // 50000000 KB ≈ 47.68 GB
    expect(disks[0].total).toBeCloseTo(47.68, 1);
  });

  it('does not crash on empty/broken output', () => {
    expect(parseDf('')).toEqual([]);
    expect(parseDf('garbage header only')).toEqual([]);
  });
});
