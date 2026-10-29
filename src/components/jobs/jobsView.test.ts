import { describe, expect, it } from 'vitest';

import { durationLabel, jobState, relativeIn, runBars, summarizeJobs } from '@/components/jobs/jobsView';
import type { ScheduledJob } from '@/types/system';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

function job(extra: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'x.timer',
    name: 'x',
    kind: 'maintenance',
    service: 'x.service',
    schedule: '*-*-* 03:00:00',
    human: 'Daily at 03:00',
    command: null,
    enabled: true,
    running: false,
    lastRunAt: iso(9),
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
    expect(bars.map(bar => bar.tip)).toEqual(['1 runs earlier · success', 'Last run · failed']);
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

  it('is not stale without any backup jobs', () => {
    expect(summarizeJobs([job()], NOW).backupStale).toBe(false);
  });
});
