import { describe, expect, it } from 'vitest';

import {
  cronLimit,
  durationLabel,
  jobState,
  outputSource,
  relativeIn,
  RUN_SLOTS,
  runBars,
  summarizeJobs
} from '@/components/jobs/jobsView';
import { PALETTE } from '@/lib/theme';
import type { ScheduledJob } from '@/types/system';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

function job(extra: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'x.timer',
    name: 'x',
    kind: 'maintenance',
    source: 'systemd timer',
    controllable: true,
    service: 'x.service',
    schedule: '*-*-* 03:00:00',
    human: 'Daily at 03:00',
    command: null,
    enabled: true,
    running: false,
    lastRunAt: iso(9),
    lastRunStartedAt: null,
    invocationId: null,
    lastDurationSec: 42,
    lastResult: 'success',
    nextRunAt: iso(-15),
    history: [],
    ...extra
  };
}

describe('jobState', () => {
  it('prioritises running, then disabled, then the last result', () => {
    expect(jobState(job({ running: true, enabled: false }))).toBe('running');
    expect(jobState(job({ enabled: false, lastResult: 'failed' }))).toBe('disabled');
    expect(jobState(job({ lastResult: 'failed' }))).toBe('failed');
    expect(jobState(job({ lastResult: null }))).toBe('never');
  });
});

describe('labels', () => {
  it('formats durations and countdowns', () => {
    expect(durationLabel(job({ lastDurationSec: 372 }))).toBe('took 6m 12s');
    expect(durationLabel(job({ running: true }))).toBe('in progress');
    expect(relativeIn(iso(-15), NOW)).toBe('in 15h 0m');
    expect(relativeIn(null, NOW)).toBe('—');
  });

  it('labels the newest bar as the last run', () => {
    const bars = runBars(
      job({
        history: [
          { at: iso(48), ok: true },
          { at: iso(24), ok: false }
        ]
      })
    );
    expect(bars).toHaveLength(RUN_SLOTS);
    expect(bars.slice(-2).map(bar => bar.tip)).toEqual(['1 runs earlier · success', 'Last run · failed']);
    expect(bars[0]).toEqual({ color: PALETTE.track, tip: 'No run recorded' });
  });
});

describe('summarizeJobs', () => {
  it('counts failures and finds the last good backup', () => {
    const summary = summarizeJobs(
      [
        job({
          kind: 'backup',
          history: [
            { at: iso(30), ok: true },
            { at: iso(6), ok: false }
          ],
          lastResult: 'failed'
        }),
        job({ enabled: false })
      ],
      NOW
    );
    expect(summary).toMatchObject({
      enabled: 1,
      total: 2,
      failing: 1,
      lastGoodBackupAt: iso(30),
      backupStale: true
    });
    expect(summary.nextBackupAt).toBe(iso(-15));
  });

  it('reads as stale when no backup has ever succeeded', () => {
    expect(summarizeJobs([job()], NOW).backupStale).toBe(true);
    expect(
      summarizeJobs([job({ kind: 'backup', history: [{ at: iso(2), ok: true }] })], NOW).backupStale
    ).toBe(false);
  });
});

describe('row actions', () => {
  const cron = job({ id: 'cron:root:abc', source: 'crontab (root)', controllable: false, service: '' });

  it('keeps cron jobs out of run/enable and output', () => {
    expect(cronLimit(job())).toBeNull();
    expect(cronLimit(cron)).toMatchObject({ allowed: false });
    expect(outputSource(cron)).toMatchObject({ allowed: false });
  });

  it('points Output at the last invocation of a timer', () => {
    expect(outputSource(job())).toEqual({ allowed: false, reason: 'No run recorded yet' });
    expect(outputSource(job({ invocationId: 'ab'.repeat(16), lastRunStartedAt: iso(9) }))).toEqual({
      kind: 'unit',
      name: 'x.service',
      run: { invocation: 'ab'.repeat(16), since: iso(9) }
    });
  });
});
