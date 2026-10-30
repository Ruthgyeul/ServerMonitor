import type { Permission } from '@/components/control/controlApi';
import { PALETTE } from '@/lib/theme';
import type { ScheduledJob } from '@/types/system';
import { formatAge } from '@/utils/timeFormat';

// Pure presentation for scheduled jobs: result pill, relative times, the
// 14-run strip, the summary cards and what each row's buttons may do.

export const JOBS_URL = '/api/jobs';
// A backup older than this reads as stale (a nightly job plus slack).
const BACKUP_STALE_MS = 26 * 60 * 60 * 1000;
// The strip always shows this many slots; runs not recorded yet stay empty.
export const RUN_SLOTS = 14;

export type JobState = 'success' | 'failed' | 'unknown' | 'running' | 'disabled' | 'never';

export const STATE_STYLE: Record<JobState, { label: string; fg: string; bg: string; dot: string }> = {
  success: { label: 'Success', fg: PALETTE.okFg, bg: 'rgba(60,207,145,0.1)', dot: PALETTE.ok },
  failed: { label: 'Failed', fg: PALETTE.critFg, bg: 'rgba(239,95,90,0.14)', dot: PALETTE.crit },
  unknown: { label: 'Unknown', fg: PALETTE.text3, bg: 'rgba(255,255,255,0.06)', dot: PALETTE.muted },
  running: { label: 'Running…', fg: PALETTE.warnFg, bg: 'rgba(232,180,69,0.12)', dot: PALETTE.warn },
  disabled: { label: 'Disabled', fg: PALETTE.muted, bg: 'rgba(255,255,255,0.06)', dot: PALETTE.faint },
  never: { label: 'Not run yet', fg: PALETTE.muted, bg: 'rgba(255,255,255,0.06)', dot: PALETTE.faint }
};

export function jobState(job: ScheduledJob): JobState {
  if (job.running) return 'running';
  if (!job.enabled) return 'disabled';
  return job.lastResult ?? 'never';
}

export function relativeAgo(at: string | null, now: number): string {
  if (!at) return '—';
  const age = formatAge(now - new Date(at).getTime());
  return age === 'now' ? 'just now' : `${age} ago`;
}

export function relativeIn(at: string | null, now: number): string {
  if (!at) return '—';
  const seconds = Math.max(0, Math.round((new Date(at).getTime() - now) / 1000));
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `in ${hours}h ${minutes % 60}m` : `in ${Math.floor(hours / 24)}d`;
}

export function durationLabel(job: ScheduledJob): string {
  if (job.running) return 'in progress';
  const seconds = job.lastDurationSec;
  if (seconds === null) return '';
  return seconds >= 60 ? `took ${Math.floor(seconds / 60)}m ${seconds % 60}s` : `took ${seconds}s`;
}

// Tooltip for a result pill, where the label alone could mislead.
export function stateTip(state: JobState): string | undefined {
  return state === 'unknown' ? "Ran — cron doesn't record exit codes and logged no failure" : undefined;
}

export function runBars(job: ScheduledJob): { color: string; tip: string }[] {
  const runs = job.history.slice(-RUN_SLOTS);
  const last = runs.length - 1;
  const recorded = runs.map((run, index) => ({
    color: run.ok === null ? PALETTE.faint : run.ok ? PALETTE.ok : PALETTE.crit,
    tip: `${index === last ? 'Last run' : `${last - index} runs earlier`} · ${
      run.ok === null ? 'result not logged' : run.ok ? 'success' : 'failed'
    }`
  }));
  const empty = Array.from({ length: RUN_SLOTS - runs.length }, () => ({
    color: PALETTE.track,
    tip: 'No run recorded'
  }));
  return [...empty, ...recorded];
}

const CRON_CONTROL_REASON = 'Cron jobs follow the crontab — edit it on the host to run or disable this job';

// Run now / Enable / Disable: only systemd timers can be controlled from here.
export function cronLimit(job: ScheduledJob): Permission | null {
  return job.controllable ? null : { allowed: false, reason: CRON_CONTROL_REASON };
}

// Output: the most recent run of a timer's service. Cron mails a job's output
// instead of logging it, so there is nothing to show for cron jobs.
export interface JobOutput {
  kind: 'unit';
  name: string;
  run: { invocation: string | null; since: string | null };
}
export function outputSource(job: ScheduledJob): JobOutput | Permission {
  if (!job.controllable || !job.service) {
    return { allowed: false, reason: "Cron mails a job's output instead of logging it" };
  }
  if (!job.invocationId && !job.lastRunStartedAt) return { allowed: false, reason: 'No run recorded yet' };
  return {
    kind: 'unit',
    name: job.service,
    run: { invocation: job.invocationId, since: job.lastRunStartedAt }
  };
}

export interface JobSummary {
  enabled: number;
  total: number;
  failing: number;
  lastGoodBackupAt: string | null;
  backupStale: boolean;
  nextBackupAt: string | null;
}

export function summarizeJobs(jobs: ScheduledJob[], now: number): JobSummary {
  const backups = jobs.filter(job => job.kind === 'backup');
  const goodRuns = backups.flatMap(job => job.history.filter(run => run.ok === true).map(run => run.at));
  const lastGood = goodRuns.length > 0 ? goodRuns.reduce((a, b) => (a > b ? a : b)) : null;
  const next = backups
    .filter(job => job.enabled && job.nextRunAt)
    .map(job => job.nextRunAt as string)
    .sort()[0];
  return {
    enabled: jobs.filter(job => job.enabled).length,
    total: jobs.length,
    failing: jobs.filter(job => jobState(job) === 'failed').length,
    lastGoodBackupAt: lastGood,
    // No successful backup at all reads as stale too, as in the design.
    backupStale: !lastGood || now - new Date(lastGood).getTime() > BACKUP_STALE_MS,
    nextBackupAt: next ?? null
  };
}
