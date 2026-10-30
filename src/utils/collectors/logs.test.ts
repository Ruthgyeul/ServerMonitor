import { describe, expect, it } from 'vitest';

import {
  dockerLogArgs,
  isInvocationId,
  isValidLogSource,
  journalArgs,
  levelOfText,
  parseDockerLogs,
  parseJournal,
  parseSince,
  unitIsActive
} from '@/utils/collectors/logs';

describe('parseJournal', () => {
  it('reads time, priority and message (string or bytes)', () => {
    const output = [
      JSON.stringify({ __REALTIME_TIMESTAMP: '1730202930123456', PRIORITY: '6', MESSAGE: 'Started ssh' }),
      JSON.stringify({ __REALTIME_TIMESTAMP: '1730202931000000', PRIORITY: '3', MESSAGE: [104, 105] }),
      'not json',
      JSON.stringify({ __REALTIME_TIMESTAMP: '1730202932000000', PRIORITY: '4', MESSAGE: 'careful' })
    ].join('\n');
    expect(parseJournal(output)).toEqual([
      { at: new Date(1730202930123).toISOString(), level: 'info', message: 'Started ssh' },
      { at: new Date(1730202931000).toISOString(), level: 'error', message: 'hi' },
      { at: new Date(1730202932000).toISOString(), level: 'warn', message: 'careful' }
    ]);
  });
});

describe('parseDockerLogs', () => {
  it('splits the RFC3339 timestamp from the message and guesses the level', () => {
    const output = [
      '2026-10-29T12:00:00.123456789Z GET / 200',
      '2026-10-29T12:00:01.5Z level=error msg="boom"',
      'continuation without timestamp'
    ].join('\n');
    expect(parseDockerLogs(output)).toEqual([
      { at: '2026-10-29T12:00:00.123Z', level: 'info', message: 'GET / 200' },
      { at: '2026-10-29T12:00:01.500Z', level: 'error', message: 'level=error msg="boom"' }
    ]);
  });
});

describe('levelOfText', () => {
  it('flags errors and warnings by keyword', () => {
    expect(levelOfText('FATAL: could not connect')).toBe('error');
    expect(levelOfText('WARNING: low memory')).toBe('warn');
    expect(levelOfText('ready to accept connections')).toBe('info');
  });
});

describe('isValidLogSource', () => {
  it('validates unit and container names', () => {
    expect(isValidLogSource('unit', 'nginx.service')).toBe(true);
    expect(isValidLogSource('unit', 'nginx.service --since=x')).toBe(false);
    expect(isValidLogSource('container', 'nginx-proxy')).toBe(true);
    expect(isValidLogSource('container', '-it')).toBe(false);
    expect(isValidLogSource('container', 'a;b')).toBe(false);
  });
});

describe('isInvocationId', () => {
  it('accepts 32 hex digits only', () => {
    expect(isInvocationId('0123456789abcdef0123456789ABCDEF')).toBe(true);
    expect(isInvocationId('0123456789abcdef')).toBe(false);
    expect(isInvocationId('0123456789abcdef0123456789abcdeg')).toBe(false);
    expect(isInvocationId('_SYSTEMD_UNIT=sshd.service')).toBe(false);
  });
});

describe('parseSince', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  it('accepts recent ISO 8601 times', () => {
    expect(parseSince('2026-10-30T03:30:00.000Z', now)).toBe(Date.UTC(2026, 9, 30, 3, 30));
    expect(parseSince('2026-10-30T12:30:00+09:00', now)).toBe(Date.UTC(2026, 9, 30, 3, 30));
  });
  it('rejects anything else', () => {
    expect(parseSince(null, now)).toBeNull();
    expect(parseSince('yesterday', now)).toBeNull();
    expect(parseSince('2026-10-30', now)).toBeNull();
    expect(parseSince('2026-10-30T03:30:00Z; rm -rf /', now)).toBeNull();
    expect(parseSince('2026-11-02T00:00:00Z', now)).toBeNull(); // future
    expect(parseSince('2020-01-01T00:00:00Z', now)).toBeNull(); // too old
  });
});

describe('journalArgs / dockerLogArgs', () => {
  it('tails a unit, or narrows to one invocation or a start time', () => {
    expect(journalArgs('backup.service', 500)).toEqual([
      '-u',
      'backup.service',
      '-n',
      '500',
      '-o',
      'json',
      '--no-pager'
    ]);
    const id = 'ABCDEF0123456789abcdef0123456789';
    expect(journalArgs('backup.service', 500, { invocation: id }).slice(0, 3)).toEqual([
      `_SYSTEMD_INVOCATION_ID=${id.toLowerCase()}`,
      '+',
      `INVOCATION_ID=${id.toLowerCase()}`
    ]);
    expect(journalArgs('backup.service', 500, { since: 1_761_795_000_500 })).toContain('@1761795000');
    expect(dockerLogArgs('web', 500, { since: 1_761_795_000_500 })).toEqual([
      'logs',
      '--tail',
      '500',
      '--timestamps',
      '--since',
      '1761795000',
      'web'
    ]);
  });
});

describe('unitIsActive', () => {
  it('treats running states as active', () => {
    expect(unitIsActive('active\n')).toBe(true);
    expect(unitIsActive('activating')).toBe(true);
    expect(unitIsActive('inactive')).toBe(false);
    expect(unitIsActive('failed')).toBe(false);
  });
});
