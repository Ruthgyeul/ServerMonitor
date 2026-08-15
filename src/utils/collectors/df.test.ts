import { describe, expect, it } from 'vitest';

import { parseDf } from '@/utils/collectors/df';

// `df -Pk` 출력 예시. 헤더 + 실 블록 장치 + 의사 파일시스템이 섞여 있다.
const SAMPLE = `Filesystem     1024-blocks      Used  Available Capacity Mounted on
udev              8123456         0    8123456       0% /dev
tmpfs             1638400      2048    1636352       1% /run
/dev/sda1        50000000  25000000   25000000      50% /
/dev/sdb1       200000000  20000000  180000000      10% /data
overlay          50000000  25000000   25000000      50% /var/lib/docker/overlay2/abc
/dev/sda1        50000000  25000000   25000000      50% /`;

describe('parseDf', () => {
  it('실 블록 장치(/dev/*)만 남기고 의사 파일시스템은 버린다', () => {
    const disks = parseDf(SAMPLE);
    const mounts = disks.map(d => d.mount);
    expect(mounts).toContain('/');
    expect(mounts).toContain('/data');
    expect(mounts).not.toContain('/run'); // tmpfs
    expect(mounts).not.toContain('/dev'); // udev
    expect(mounts.some(m => m.includes('overlay'))).toBe(false);
  });

  it('중복 마운트는 한 번만 센다', () => {
    const roots = parseDf(SAMPLE).filter(d => d.mount === '/');
    expect(roots).toHaveLength(1);
  });

  it('루트를 맨 앞에 두고 GB/퍼센트를 계산한다', () => {
    const disks = parseDf(SAMPLE);
    expect(disks[0].mount).toBe('/');
    expect(disks[0].percentage).toBe(50);
    // 50000000 KB ≈ 47.68 GB
    expect(disks[0].total).toBeCloseTo(47.68, 1);
  });

  it('빈/깨진 출력에도 죽지 않는다', () => {
    expect(parseDf('')).toEqual([]);
    expect(parseDf('garbage header only')).toEqual([]);
  });
});
