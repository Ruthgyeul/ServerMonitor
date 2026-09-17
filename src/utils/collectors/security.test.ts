import { describe, expect, it } from 'vitest';

import {
  mergeSessions,
  parseBlockedCount,
  parsePortScanLines,
  parseUfwConf,
  parseWhoOutput,
  type Session
} from '@/utils/collectors/security';

describe('parseWhoOutput', () => {
  it('keeps only rows that carry a remote origin', () => {
    const output = [
      'deploy   pts/1        2024-07-20 14:35 (192.168.0.5)',
      'root     tty1         2024-07-20 09:00' // local console, no origin
    ].join('\n');

    const sessions = parseWhoOutput(output);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ user: 'deploy', tty: 'pts/1', ip: '192.168.0.5' });
    expect(sessions[0].since).toBe(new Date('2024-07-20T14:35').toISOString());
  });

  it('returns empty for empty input', () => {
    expect(parseWhoOutput('')).toEqual([]);
  });
});

describe('mergeSessions', () => {
  it('merges by tty, keeping the real IP and earliest login', () => {
    const fromProc: Session[] = [
      { user: 'deploy', tty: 'pts/1', ip: '—', since: '2024-07-20T14:40:00.000Z' }
    ];
    const fromWho: Session[] = [
      { user: 'deploy', tty: 'pts/1', ip: '192.168.0.5', since: '2024-07-20T14:35:00.000Z' }
    ];

    const merged = mergeSessions(fromProc, fromWho);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      user: 'deploy',
      ip: '192.168.0.5',
      since: '2024-07-20T14:35:00.000Z'
    });
  });

  it('sorts most recent login first', () => {
    const merged = mergeSessions([
      { user: 'a', tty: 'pts/1', ip: '10.0.0.1', since: '2024-07-20T10:00:00.000Z' },
      { user: 'b', tty: 'pts/2', ip: '10.0.0.2', since: '2024-07-20T12:00:00.000Z' }
    ]);
    expect(merged.map(s => s.user)).toEqual(['b', 'a']);
  });
});

describe('parseUfwConf', () => {
  it('reads the ENABLED flag', () => {
    expect(parseUfwConf('ENABLED=yes\nLOGLEVEL=low')).toBe('active');
    expect(parseUfwConf('ENABLED=no')).toBe('inactive');
    expect(parseUfwConf('# nothing here')).toBe('inactive');
  });
});

describe('parseBlockedCount', () => {
  it('returns the blocked count when the journal was readable', () => {
    expect(parseBlockedCount('1500 42')).toBe(42);
    expect(parseBlockedCount('1500 0')).toBe(0);
  });

  it('returns null when no journal lines were seen (no access)', () => {
    expect(parseBlockedCount('0 0')).toBeNull();
  });
});

describe('parsePortScanLines', () => {
  it('flags a source IP that hit at least `threshold` distinct ports', () => {
    const lines = [
      '[UFW BLOCK] SRC=10.0.0.5 DST=1.2.3.4 DPT=22',
      '[UFW BLOCK] SRC=10.0.0.5 DST=1.2.3.4 DPT=80',
      '[UFW BLOCK] SRC=10.0.0.5 DST=1.2.3.4 DPT=443'
    ].join('\n');

    expect(parsePortScanLines(lines, 3)).toEqual([{ ip: '10.0.0.5', distinctPorts: 3, hits: 3 }]);
  });

  it('does not flag an IP below the threshold', () => {
    const lines = ['[UFW BLOCK] SRC=10.0.0.5 DPT=22', '[UFW BLOCK] SRC=10.0.0.5 DPT=80'].join('\n');
    expect(parsePortScanLines(lines, 3)).toEqual([]);
  });

  it('counts the same port hit repeatedly only once toward distinctPorts, but tallies every hit', () => {
    const lines = [
      '[UFW BLOCK] SRC=10.0.0.5 DPT=22',
      '[UFW BLOCK] SRC=10.0.0.5 DPT=22',
      '[UFW BLOCK] SRC=10.0.0.5 DPT=80'
    ].join('\n');
    expect(parsePortScanLines(lines, 2)).toEqual([{ ip: '10.0.0.5', distinctPorts: 2, hits: 3 }]);
  });

  it('tracks multiple source IPs independently and sorts by distinctPorts descending', () => {
    const lines = [
      '[UFW BLOCK] SRC=10.0.0.5 DPT=22',
      '[UFW BLOCK] SRC=10.0.0.5 DPT=80',
      '[UFW BLOCK] SRC=10.0.0.5 DPT=443',
      '[UFW BLOCK] SRC=10.0.0.9 DPT=22',
      '[UFW BLOCK] SRC=10.0.0.9 DPT=23'
    ].join('\n');
    expect(parsePortScanLines(lines, 2)).toEqual([
      { ip: '10.0.0.5', distinctPorts: 3, hits: 3 },
      { ip: '10.0.0.9', distinctPorts: 2, hits: 2 }
    ]);
  });

  it('ignores lines without both SRC and DPT', () => {
    expect(parsePortScanLines('some unrelated kernel log line', 1)).toEqual([]);
  });

  it('returns an empty list for empty output', () => {
    expect(parsePortScanLines('', 1)).toEqual([]);
  });
});
