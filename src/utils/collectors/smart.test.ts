import { describe, expect, it } from 'vitest';

import { parseSmartJson, parseSmartScan } from '@/utils/collectors/smart';

describe('parseSmartScan', () => {
  it('extracts device names', () => {
    const raw = JSON.stringify({ devices: [{ name: '/dev/sda' }, { name: '/dev/nvme0' }] });
    expect(parseSmartScan(raw)).toEqual(['/dev/sda', '/dev/nvme0']);
  });

  it('returns empty on malformed JSON', () => {
    expect(parseSmartScan('not json')).toEqual([]);
  });
});

describe('parseSmartJson', () => {
  it('summarises health, temperature and power-on hours', () => {
    const raw = JSON.stringify({
      smart_status: { passed: true },
      temperature: { current: 41 },
      power_on_time: { hours: 12000 }
    });
    expect(parseSmartJson(raw, '/dev/sda')).toEqual({
      device: '/dev/sda',
      healthy: true,
      temperature: 41,
      powerOnHours: 12000
    });
  });

  it('reports a failing assessment', () => {
    const raw = JSON.stringify({ smart_status: { passed: false } });
    expect(parseSmartJson(raw, '/dev/sdb')).toMatchObject({ healthy: false, temperature: 'N/A' });
  });

  it('returns null on malformed JSON', () => {
    expect(parseSmartJson('nope', '/dev/sda')).toBeNull();
  });
});
