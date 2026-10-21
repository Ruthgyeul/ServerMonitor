import { describe, expect, it } from 'vitest';

import { buildContainers, parseDockerBytes, parseJsonLines } from '@/utils/collectors/docker';

describe('parseDockerBytes', () => {
  it('parses decimal (SI) units used for net/block I/O', () => {
    expect(parseDockerBytes('1.2kB')).toBeCloseTo(1200);
    expect(parseDockerBytes('3.4MB')).toBeCloseTo(3_400_000);
    expect(parseDockerBytes('2GB')).toBeCloseTo(2_000_000_000);
  });

  it('parses binary units used for memory', () => {
    expect(parseDockerBytes('128.4MiB')).toBeCloseTo(128.4 * 1024 ** 2);
    expect(parseDockerBytes('1.943GiB')).toBeCloseTo(1.943 * 1024 ** 3);
  });

  it('handles bare bytes and zero', () => {
    expect(parseDockerBytes('0B')).toBe(0);
    expect(parseDockerBytes('512B')).toBe(512);
    expect(parseDockerBytes(' 648kB ')).toBeCloseTo(648_000);
  });

  it('returns null for unparseable input', () => {
    expect(parseDockerBytes('')).toBeNull();
    expect(parseDockerBytes('--')).toBeNull();
    expect(parseDockerBytes('10ZB')).toBeNull();
  });
});

describe('parseJsonLines', () => {
  it('parses newline-delimited JSON and skips blank/malformed lines', () => {
    const rows = parseJsonLines<{ a: number }>('{"a":1}\n\n{bad}\n{"a":2}\n');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe('buildContainers', () => {
  const psRows = [
    { ID: 'aaaaaaaaaaaa', Names: 'web', Image: 'nginx', State: 'running', Status: 'Up 3 hours' },
    { ID: 'bbbbbbbbbbbb', Names: 'db,db-alias', Image: 'postgres', State: 'exited', Status: 'Exited (0)' }
  ];

  it('merges ps roster with stats and counts running/total', () => {
    const statsRows = [
      {
        ID: 'aaaaaaaaaaaa',
        CPUPerc: '12.50%',
        MemUsage: '128.4MiB / 1.943GiB',
        MemPerc: '6.45%',
        NetIO: '1.2kB / 3.4kB',
        BlockIO: '0B / 4.1MB'
      }
    ];

    const result = buildContainers(psRows, statsRows, new Map(), 1000);
    expect(result.total).toBe(2);
    expect(result.running).toBe(1);

    const web = result.containers.find(c => c.id === 'aaaaaaaaaaaa')!;
    expect(web.cpuPercent).toBe(12.5);
    expect(web.memUsedMb).toBeCloseTo(128.4, 1);
    expect(web.memPercent).toBe(6.45);
    expect(web.netRxBytes).toBeCloseTo(1200);

    // The stopped container has no stats row → usage fields null, roster intact.
    const db = result.containers.find(c => c.id === 'bbbbbbbbbbbb')!;
    expect(db.name).toBe('db'); // first of a comma-separated name list
    expect(db.state).toBe('exited');
    expect(db.cpuPercent).toBeNull();
    expect(db.netRxBytes).toBeNull();
  });

  it('computes per-container and aggregate net rate from the previous sample', () => {
    const prev = new Map([['aaaaaaaaaaaa', { rx: 1000, tx: 2000, at: 0 }]]);
    const statsRows = [
      {
        ID: 'aaaaaaaaaaaa',
        CPUPerc: '0%',
        MemUsage: '10MiB / 1GiB',
        MemPerc: '1%',
        // +2048 bytes rx, +1024 bytes tx over 2 seconds → 1 KB/s and 0.5 KB/s.
        NetIO: '3.048kB / 3.024kB',
        BlockIO: '0B / 0B'
      }
    ];

    const result = buildContainers(psRows, statsRows, prev, 2000);
    const web = result.containers.find(c => c.id === 'aaaaaaaaaaaa')!;
    expect(web.netRxRate).toBeCloseTo(1, 1);
    expect(web.netTxRate).toBeCloseTo(0.5, 1);
    expect(result.netRxRate).toBeCloseTo(1, 1);
    expect(result.netTxRate).toBeCloseTo(0.5, 1);
  });

  it('clamps a negative delta (container restart) to zero', () => {
    const prev = new Map([['aaaaaaaaaaaa', { rx: 1_000_000, tx: 1_000_000, at: 0 }]]);
    const statsRows = [
      { ID: 'aaaaaaaaaaaa', CPUPerc: '0%', MemUsage: '1MiB / 1GiB', MemPerc: '0%', NetIO: '0B / 0B', BlockIO: '0B / 0B' }
    ];

    const result = buildContainers(psRows, statsRows, prev, 1000);
    const web = result.containers.find(c => c.id === 'aaaaaaaaaaaa')!;
    expect(web.netRxRate).toBe(0);
    expect(web.netTxRate).toBe(0);
  });

  it('leaves the rate null on the first sample', () => {
    const statsRows = [
      { ID: 'aaaaaaaaaaaa', CPUPerc: '0%', MemUsage: '1MiB / 1GiB', MemPerc: '0%', NetIO: '5kB / 5kB', BlockIO: '0B / 0B' }
    ];
    const result = buildContainers(psRows, statsRows, new Map(), 1000);
    const web = result.containers.find(c => c.id === 'aaaaaaaaaaaa')!;
    expect(web.netRxRate).toBeNull();
    expect(web.netTxRate).toBeNull();
    // A sample is still recorded so the next tick can compute a rate.
    expect(result.samples.get('aaaaaaaaaaaa')).toBeTruthy();
  });

  it('sorts running ahead of stopped and caps nothing under the limit', () => {
    const result = buildContainers(psRows, [], new Map(), 1000);
    expect(result.containers[0].state).toBe('running');
  });
});
