import { describe, expect, it } from 'vitest';

import {
  buildCronJob,
  cronJobId,
  describeCron,
  nameOf,
  expandField,
  nextCronRun,
  parseCronRuns,
  parseCrontab,
  periodicDir
} from '@/utils/collectors/cronJobs';

const SYSTEM = `# /etc/crontab
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
17 *	* * *	root	cd / && run-parts --report /etc/cron.hourly
25 6	* * *	root	test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.daily; }
0 3 * * * postgres pg_dump -Fc monitor > /backup/pg/monitor.dump
@reboot root /usr/local/bin/warmup
@bogus root nope`;

describe('parseCrontab', () => {
  it('reads system lines with a user column and skips variables and comments', () => {
    const entries = parseCrontab(SYSTEM, { system: true, source: 'crontab (system)' });
    expect(entries.map(entry => [entry.schedule, entry.user])).toEqual([
      ['17 * * * *', 'root'],
      ['25 6 * * *', 'root'],
      ['0 3 * * *', 'postgres'],
      ['@reboot', 'root']
    ]);
    expect(entries[2].command).toBe('pg_dump -Fc monitor > /backup/pg/monitor.dump');
  });

  it('reads user crontabs without a user column', () => {
    const [entry] = parseCrontab('15 */6 * * * psql monitor -c "VACUUM (ANALYZE)"', {
      system: false,
      user: 'postgres',
      source: 'crontab (postgres)'
    });
    expect(entry).toMatchObject({ schedule: '15 */6 * * *', user: 'postgres', source: 'crontab (postgres)' });
  });

  it('finds run-parts directories', () => {
    expect(periodicDir('test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.daily; }')).toBe(
      'daily'
    );
    expect(periodicDir('pg_dump x')).toBeNull();
  });
});

describe('schedules', () => {
  it('expands fields with ranges, steps, lists and names', () => {
    expect([...expandField('*/15', 0, 59)!]).toEqual([0, 15, 30, 45]);
    expect([...expandField('1-5', 0, 6)!]).toEqual([1, 2, 3, 4, 5]);
    expect([...expandField('mon,wed', 0, 6, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])!]).toEqual([
      1, 3
    ]);
    expect(expandField('61', 0, 59)).toBeNull();
  });

  it('computes the next run in local time', () => {
    const at = new Date(2026, 9, 29, 12, 0, 0).getTime();
    expect(nextCronRun('0 3 * * *', at)).toBe(new Date(2026, 9, 30, 3, 0, 0).getTime());
    expect(nextCronRun('15 */6 * * *', at)).toBe(new Date(2026, 9, 29, 12, 15, 0).getTime());
    expect(nextCronRun('0 4 * * 0', at)).toBe(new Date(2026, 10, 1, 4, 0, 0).getTime()); // next Sunday
    expect(nextCronRun('@monthly', at)).toBe(new Date(2026, 10, 1, 0, 0, 0).getTime());
    expect(nextCronRun('@reboot', at)).toBeNull();
  });

  it('describes schedules like the timer descriptions', () => {
    expect(describeCron('0 3 * * *')).toBe('Daily at 03:00');
    expect(describeCron('0 0,12 * * *')).toBe('Twice daily');
    expect(describeCron('15 */6 * * *')).toBe('Every 6 hours');
    expect(describeCron('0 4 * * 0')).toBe('Weekly · Sun 04:00');
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
    expect(describeCron('@daily')).toBe('Daily at 00:00');
    expect(describeCron('0 2 1 * *')).toBe('Monthly · day 1 at 02:00');
    expect(describeCron('09,39 * * * *')).toBe('Hourly at :09, :39');
  });
});

const line = (seconds: number, pid: string, message: string) =>
  JSON.stringify({ __REALTIME_TIMESTAMP: String(seconds * 1_000_000), _PID: pid, MESSAGE: message });

describe('parseCronRuns', () => {
  it('pairs CMD lines with session close and failures by pid', () => {
    const output = [
      line(1000, '11', '(postgres) CMD (pg_dump -Fc monitor > /backup/pg/monitor.dump)'),
      line(1000, '11', 'pam_unix(cron:session): session opened for user postgres(uid=110) by (uid=0)'),
      line(1042, '11', 'pam_unix(cron:session): session closed for user postgres'),
      line(2000, '12', '(postgres) CMD (pg_dump -Fc monitor > /backup/pg/monitor.dump)'),
      line(2005, '12', '(postgres) FAILED (exit status 1)'),
      line(3000, '13', '(root) CMD (other)'),
      line(3001, '13', '(root) END (other)')
    ].join('\n');
    const runs = parseCronRuns(output);
    const backup = runs.get('postgres\u0000pg_dump -Fc monitor > /backup/pg/monitor.dump')!;
    expect(backup).toEqual([
      { startedAt: 1_000_000, endedAt: 1_042_000, ok: null },
      { startedAt: 2_000_000, endedAt: 2_005_000, ok: false }
    ]);
    expect(runs.get('root\u0000other')![0].ok).toBe(true);
  });
});

describe('buildCronJob', () => {
  const entry = {
    schedule: '0 3 * * *',
    user: 'postgres',
    command: 'pg_dump -Fc monitor > /backup/pg/monitor.dump',
    source: 'crontab (postgres)'
  };

  it('builds a backup job with duration, unknown result and next run', () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    const started = new Date(2026, 9, 29, 3, 0, 0).getTime();
    const job = buildCronJob(entry, [{ startedAt: started, endedAt: started + 42_000, ok: null }], now);
    expect(job).toMatchObject({
      id: cronJobId(entry),
      name: 'pg_dump',
      kind: 'backup',
      source: 'crontab (postgres)',
      controllable: false,
      human: 'Daily at 03:00',
      lastDurationSec: 42,
      lastResult: 'unknown',
      nextRunAt: new Date(2026, 9, 30, 3, 0, 0).toISOString(),
      history: [{ at: new Date(started + 42_000).toISOString(), ok: null }]
    });
    expect(job.id).toMatch(/^cron:postgres:[0-9a-f]{10}$/);
  });

  it('applies overrides and reports never-run jobs', () => {
    const job = buildCronJob(entry, [], Date.now(), { name: 'Postgres backup' });
    expect(job).toMatchObject({ name: 'Postgres backup', lastResult: null, lastRunAt: null });
  });
});

describe('nameOf', () => {
  it.each([
    ['/usr/bin/restic backup /srv --tag nightly', 'restic'],
    [
      '[ -x /usr/lib/php/sessionclean ] && if [ ! -d /run/systemd/system ]; then /usr/lib/php/sessionclean; fi',
      'sessionclean'
    ],
    ['cd /srv/app && ./scripts/rotate.sh >/dev/null 2>&1', 'rotate.sh'],
    ['PATH=/usr/local/bin nice -n 10 /opt/backup/run.sh', 'run.sh'],
    ['test -x /usr/sbin/anacron', 'test']
  ])('%s → %s', (command, name) => {
    expect(nameOf(command)).toBe(name);
  });
});
