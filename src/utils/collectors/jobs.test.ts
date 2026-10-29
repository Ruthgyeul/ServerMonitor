import { describe, expect, it } from 'vitest';

import {
  buildJob,
  describeCalendar,
  describeMonotonic,
  parseExecStart,
  parseJobsConfig,
  parseRunHistory,
  parseShowBlocks,
  parseTimerList
} from '@/utils/collectors/jobs';

const TIMER_SHOW = `Id=restic-backup.timer
Description=Nightly restic backup
Unit=restic-backup.service
ActiveState=active
TimersCalendar={ OnCalendar=*-*-* 03:30:00 ; next_elapse=@1761795000 }
TimersMonotonic=
LastTriggerUSec=@1761708600
NextElapseUSecRealtime=@1761795000

Id=fstrim.timer
Description=Discard unused filesystem blocks once a week
Unit=fstrim.service
ActiveState=inactive
TimersCalendar={ OnCalendar=Mon *-*-* 00:00:00 ; next_elapse=@1761523200 }
LastTriggerUSec=n/a
NextElapseUSecRealtime=`;

const SERVICE_SHOW = `Id=restic-backup.service
ActiveState=inactive
SubState=dead
Result=exit-code
ExecMainStartTimestamp=@1761708600
ExecMainExitTimestamp=@1761708972
ExecStart={ path=/usr/bin/restic ; argv[]=/usr/bin/restic backup /backup /etc --tag nightly ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }`;

function journalLine(seconds: number, messageId: string): string {
  return JSON.stringify({ __REALTIME_TIMESTAMP: String(seconds * 1_000_000), MESSAGE_ID: messageId });
}
const OK = '7ad2d189f7e94e70a38c781354912448';
const FAIL = 'd9b373ed55a64feb8242e02dbe79a49c';

describe('parseShowBlocks', () => {
  it('splits units and keeps their properties', () => {
    const units = parseShowBlocks(TIMER_SHOW);
    expect([...units.keys()]).toEqual(['restic-backup.timer', 'fstrim.timer']);
    expect(units.get('fstrim.timer')?.ActiveState).toEqual(['inactive']);
  });
});

describe('parseTimerList', () => {
  it('keeps loaded timer names only', () => {
    const output = `apt-daily.timer loaded active waiting Daily apt download activities
ghost.timer not-found inactive dead ghost.timer
bogus;rm.timer loaded active waiting x`;
    expect(parseTimerList(output)).toEqual(['apt-daily.timer']);
  });
});

describe('describeCalendar', () => {
  it.each([
    ['*-*-* 03:30:00', 'Daily at 03:30'],
    ['*-*-* 00,12:00:00', 'Twice daily'],
    ['*-*-* 06,12,18:15:00', 'Daily at 06:15, 12:15, 18:15'],
    ['Sun *-*-* 04:00:00', 'Weekly · Sun 04:00'],
    ['*-*-* *:00:00', 'Hourly at :00'],
    ['*-*-* 00/6:15:00', 'Every 6 hours'],
    ['*-*-01 02:00:00', 'Monthly · day 1 at 02:00'],
    ['2026-*-* 01..04:00:00', '2026-*-* 01..04:00:00']
  ])('%s → %s', (spec, human) => {
    expect(describeCalendar(spec)).toBe(human);
  });

  it('describes monotonic timers', () => {
    expect(describeMonotonic('OnUnitActiveUSec', '1d')).toBe('Every 1d');
    expect(describeMonotonic('OnBootUSec', '15min')).toBe('15min after boot');
  });
});

describe('parseExecStart', () => {
  it('extracts the argv', () => {
    expect(parseExecStart(SERVICE_SHOW.split('\n').at(-1)!.slice('ExecStart='.length))).toBe(
      '/usr/bin/restic backup /backup /etc --tag nightly'
    );
    expect(parseExecStart(undefined)).toBeNull();
  });
});

describe('parseRunHistory', () => {
  it('keeps success/failure records only, newest 14', () => {
    const lines = [
      JSON.stringify({ __REALTIME_TIMESTAMP: '1', MESSAGE: 'Starting…' }),
      ...Array.from({ length: 15 }, (_, index) =>
        journalLine(1_761_000_000 + index * 60, index === 14 ? FAIL : OK)
      ),
      'not json'
    ];
    const runs = parseRunHistory(lines.join('\n'));
    expect(runs).toHaveLength(14);
    expect(runs.at(-1)).toEqual({ at: new Date((1_761_000_000 + 14 * 60) * 1000).toISOString(), ok: false });
    expect(runs[0].ok).toBe(true);
  });
});

describe('parseJobsConfig', () => {
  it('reads overrides and ignores malformed JSON', () => {
    expect(parseJobsConfig('{"a.timer":{"name":"A","kind":"backup"},"b.timer":{"hidden":true}}')).toEqual({
      'a.timer': { name: 'A', kind: 'backup', hidden: false },
      'b.timer': { name: undefined, kind: undefined, hidden: true }
    });
    expect(parseJobsConfig('[1,2]')).toEqual({});
    expect(parseJobsConfig(undefined)).toEqual({});
  });
});

describe('buildJob', () => {
  const timers = parseShowBlocks(TIMER_SHOW);
  const services = parseShowBlocks(SERVICE_SHOW);

  it('combines timer, service and history', () => {
    const history = [{ at: '2026-10-29T03:36:12.000Z', ok: false }];
    const job = buildJob(timers.get('restic-backup.timer')!, services.get('restic-backup.service'), history);
    expect(job).toMatchObject({
      id: 'restic-backup.timer',
      name: 'Nightly restic backup',
      kind: 'backup',
      service: 'restic-backup.service',
      schedule: '*-*-* 03:30:00',
      human: 'Daily at 03:30',
      command: '/usr/bin/restic backup /backup /etc --tag nightly',
      enabled: true,
      running: false,
      lastRunAt: '2026-10-29T03:36:12.000Z',
      lastDurationSec: 372,
      lastResult: 'failed',
      nextRunAt: new Date(1761795000 * 1000).toISOString()
    });
  });

  it('falls back to the service result without journal history, and applies overrides', () => {
    const job = buildJob(timers.get('fstrim.timer')!, undefined, [], { name: 'Weekly TRIM', kind: 'backup' });
    expect(job).toMatchObject({
      name: 'Weekly TRIM',
      kind: 'backup',
      enabled: false,
      lastResult: null,
      lastRunAt: null,
      nextRunAt: null,
      human: 'Weekly · Mon 00:00'
    });
  });
});
