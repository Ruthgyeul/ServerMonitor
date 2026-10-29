import { ScheduledJob, UptimeCheck } from '@/types/system';
import type { ExternalCondition } from '@/utils/collectors/alerts';
import { listJobs } from '@/utils/collectors/jobs';
import { uptime } from '@/utils/collectors/uptime';

// Alert conditions from outside the metric rules: failing HTTP checks, failed
// scheduled jobs and failed systemd units. Builders are pure for testing.

export function uptimeConditions(checks: UptimeCheck[]): ExternalCondition[] {
  return checks.flatMap(check => {
    const last = check.history.at(-1);
    if (check.paused || !last || last.ok) return [];
    return [
      {
        key: `http:${check.id}`,
        level: 'critical' as const,
        message: `HTTP check failed: ${check.name} (${last.code ?? last.error ?? 'timeout'})`,
        recoveredMessage: `HTTP check recovered: ${check.name}`,
        rule: 'uptime check'
      }
    ];
  });
}

// A failed backup is critical; any other failed job is a warning.
export function jobConditions(jobs: ScheduledJob[]): ExternalCondition[] {
  return jobs
    .filter(job => job.enabled && !job.running && job.lastResult === 'failed')
    .map(job => ({
      key: `job:${job.id}`,
      level: job.kind === 'backup' ? ('critical' as const) : ('warning' as const),
      message: `Job failed: ${job.name}`,
      recoveredMessage: `Job recovered: ${job.name}`,
      rule: 'job exit ≠ 0'
    }));
}

export function unitConditions(failedUnits: string[]): ExternalCondition[] {
  return failedUnits.map(unit => ({
    key: `svc:${unit}`,
    level: 'critical' as const,
    message: `Service failed: ${unit}`,
    recoveredMessage: `Service recovered: ${unit}`,
    rule: 'systemctl --failed'
  }));
}

// The job list is refreshed in the background (it reads several journals), so
// a collection tick never waits on it; the last result is used meanwhile.
let lastJobs: ScheduledJob[] = [];
let refreshing = false;

function refreshJobs(): void {
  if (refreshing) return;
  refreshing = true;
  listJobs()
    .then(list => {
      lastJobs = list.jobs;
    })
    .catch(() => {
      /* keep the last list */
    })
    .finally(() => {
      refreshing = false;
    });
}

export function collectExternalConditions(failedUnits: string[]): ExternalCondition[] {
  refreshJobs();
  return [...uptimeConditions(uptime().list()), ...jobConditions(lastJobs), ...unitConditions(failedUnits)];
}
