import { describe, expect, it } from 'vitest';

import { isValidLogSource, levelOfText, parseDockerLogs, parseJournal } from '@/utils/collectors/logs';

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
