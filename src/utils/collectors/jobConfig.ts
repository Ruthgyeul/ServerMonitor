import { JobKind } from '@/types/system';
import { logger } from '@/utils/logger';

// Settings shared by the timer and cron job collectors.

export const HISTORY_RUNS = 14;

export interface JobOverride {
  name?: string;
  kind?: JobKind;
  hidden?: boolean;
}

// JOBS_CONFIG: a JSON object keyed by job id (a timer unit, or a cron job's
// cron:<user>:<hash> id as shown on the Jobs page), e.g.
// {"restic-backup.timer":{"name":"Offsite backup","kind":"backup"},"motd-news.timer":{"hidden":true}}
export function parseJobsConfig(raw: string | undefined): Record<string, JobOverride> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const overrides: Record<string, JobOverride> = {};
    for (const [timer, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      overrides[timer] = {
        name: typeof entry.name === 'string' ? entry.name : undefined,
        kind: entry.kind === 'backup' || entry.kind === 'maintenance' ? entry.kind : undefined,
        hidden: entry.hidden === true
      };
    }
    return overrides;
  } catch {
    logger.warn('config: JOBS_CONFIG is not a valid JSON object; ignoring it');
    return {};
  }
}

export function defaultKind(timer: string): JobKind {
  return /backup|dump|snapshot|restic|borg/i.test(timer) ? 'backup' : 'maintenance';
}
