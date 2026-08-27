import { describe, expect, it } from 'vitest';

import { parseReadOnlyMounts } from '@/utils/collectors/mounts';

const MOUNTS = `sysfs /sys sysfs rw,nosuid,nodev,noexec 0 0
/dev/sda1 / ext4 rw,relatime 0 0
/dev/sdb1 /data ext4 ro,relatime 0 0
tmpfs /run tmpfs rw,nosuid 0 0
/dev/sr0 /media/cdrom iso9660 ro,relatime 0 0
`;

describe('parseReadOnlyMounts', () => {
  it('reports real block devices mounted read-only', () => {
    const ro = parseReadOnlyMounts(MOUNTS);
    expect(ro).toHaveLength(1);
    expect(ro[0]).toMatchObject({ mount: '/data', device: '/dev/sdb1', fstype: 'ext4' });
  });

  it('ignores pseudo filesystems and rw mounts', () => {
    expect(parseReadOnlyMounts('/dev/sda1 / ext4 rw,relatime 0 0')).toHaveLength(0);
    expect(parseReadOnlyMounts('tmpfs /run tmpfs ro 0 0')).toHaveLength(0);
  });
});
