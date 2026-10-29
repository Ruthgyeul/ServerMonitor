import { JobKind, JobList, JobRun, ScheduledJob } from '@/types/system';
import { runArgs, withTtl } from '@/utils/collectors/shell';
import { logger } from '@/utils/logger';

// Backups and scheduled jobs, read from systemd timers: the schedule and next
// run from the timer, the last result and command from the service it starts,
// and the recent run history from that service's journal. Cron entries are not
// listed — cron records no exit status, so their results can't be known.
// Parsers are pure and exported for testing.

export const HISTORY_RUNS = 14;
const HISTORY_SINCE = '-30d';
const JOURNAL_LIMIT = '5000';

// journald MESSAGE_IDs systemd logs when a unit stops (systemd ≥ 248).
const MESSAGE_UNIT_SUCCESS = '7ad2d189f7e94e70a38c781354912448';
const MESSAGE_UNIT_FAILURE = 'd9b373ed55a64feb8242e02dbe79a49c';

const TIMER_NAME = /^[A-Za-z0-9:_.@\\-]+\.timer$/;
const UNIT_NAME = /^[A-Za-z0-9:_.@\\-]+\.(service|target|socket|path)$/;

export function isTimerName(name: string): boolean {
  return TIMER_NAME.test(name) && name.length <= 256;
}

// --- Pure parsers ----------------------------------------------------------

// `systemctl show` output: blank-line separated blocks of Key=Value. Repeated
// keys (TimersCalendar on a timer with several OnCalendar lines) are kept.
export function parseShowBlocks(output: string): Map<string, Record<string, string[]>> {
  const units = new Map<string, Record<string, string[]>>();
  for (const block of output.split(/\n\s*\n/)) {
    const props: Record<string, string[]> = {};
    for (const line of block.split('\n')) {
      const split = line.indexOf('=');
      if (split <= 0) continue;
      const key = line.slice(0, split).trim();
      (props[key] ??= []).push(line.slice(split + 1).trim());
    }
    const id = props.Id?.[0];
    if (id) units.set(id, props);
  }
  return units;
}

// `--timestamp=unix` values look like "@1761708600"; unset ones are empty or "n/a".
export function parseUnixStamp(value: string | undefined): string | null {
  if (!value?.startsWith('@')) return null;
  const seconds = Number(value.slice(1));
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

// "{ OnCalendar=*-*-* 03:30:00 ; next_elapse=… }" → "*-*-* 03:30:00".
export function calendarSpecs(values: string[] = []): string[] {
  return values.flatMap(value => {
    const match = value.match(/OnCalendar=(.*?)\s*;/);
    return match ? [match[1].trim()] : [];
  });
}

// "{ OnUnitActiveUSec=1d ; next_elapse=… }" → { base: 'OnUnitActiveUSec', span: '1d' }.
export function monotonicSpecs(values: string[] = []): { base: string; span: string }[] {
  return values.flatMap(value => {
    const match = value.match(/(On\w+?)=(.*?)\s*;/);
    return match ? [{ base: match[1], span: match[2].trim() }] : [];
  });
}

const pad = (part: string) => part.padStart(2, '0');

// Pure: a readable form of a normalized OnCalendar spec. Falls back to the
// spec itself for anything unusual — never guesses.
export function describeCalendar(spec: string): string {
  const parts = spec.trim().split(/\s+/);
  const [dow, date, time] = parts.length === 3 ? parts : [null, parts[0], parts[1]];
  if (!date || !time) return spec;
  const [hour, minute] = time.split(':');
  if (hour === undefined || minute === undefined || !/^\d+$/.test(minute)) return spec;
  const at = (h: string) => `${pad(h)}:${pad(minute)}`;

  if (hour === '*') return date === '*-*-*' && !dow ? `Hourly at :${pad(minute)}` : spec;
  const step = hour.match(/^(?:\*|0+)\/(\d+)$/);
  if (step && date === '*-*-*' && !dow) return `Every ${Number(step[1])} hours`;
  if (!/^\d+(,\d+)*$/.test(hour)) return spec;

  const hours = hour.split(',');
  const times = hours.map(at).join(', ');
  if (date === '*-*-*') {
    if (dow) return `Weekly · ${dow} ${times}`;
    return hours.length === 2 ? 'Twice daily' : `Daily at ${times}`;
  }
  const monthly = date.match(/^\*-\*-(\d+)$/);
  if (monthly && !dow) return `Monthly · day ${Number(monthly[1])} at ${times}`;
  return spec;
}

export function describeMonotonic(base: string, span: string): string {
  switch (base) {
    case 'OnUnitActiveUSec':
    case 'OnUnitInactiveUSec':
      return `Every ${span}`;
    case 'OnBootUSec':
    case 'OnStartupUSec':
      return `${span} after boot`;
    case 'OnActiveUSec':
      return `${span} after timer start`;
    default:
      return `${base.replace(/USec$/, '')} ${span}`;
  }
}

// ExecStart "{ path=/usr/bin/restic ; argv[]=/usr/bin/restic backup /srv ; ignore_errors=no ; … }".
export function parseExecStart(value: string | undefined): string | null {
  const match = value?.match(/argv\[\]=(.*?)\s*;\s*\w+=/);
  return match ? match[1].trim() || null : null;
}

interface JournalRecord {
  __REALTIME_TIMESTAMP?: string;
  MESSAGE_ID?: string;
}

// Pure: `journalctl -u <service> -o json` → finished runs, oldest first.
export function parseRunHistory(output: string, limit = HISTORY_RUNS): JobRun[] {
  const runs: JobRun[] = [];
  for (const raw of output.split('\n')) {
    if (!raw.trim()) continue;
    let record: JournalRecord;
    try {
      record = JSON.parse(raw) as JournalRecord;
    } catch {
      continue;
    }
    const ok =
      record.MESSAGE_ID === MESSAGE_UNIT_SUCCESS
        ? true
        : record.MESSAGE_ID === MESSAGE_UNIT_FAILURE
          ? false
          : null;
    const micros = Number(record.__REALTIME_TIMESTAMP);
    if (ok === null || !Number.isFinite(micros)) continue;
    runs.push({ at: new Date(Math.floor(micros / 1000)).toISOString(), ok });
  }
  return runs.slice(-limit);
}

// --- Configuration ---------------------------------------------------------

export interface JobOverride {
  name?: string;
  kind?: JobKind;
  hidden?: boolean;
}

// JOBS_CONFIG: a JSON object keyed by timer, e.g.
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

function defaultKind(timer: string): JobKind {
  return /backup|dump|snapshot|restic|borg/i.test(timer) ? 'backup' : 'maintenance';
}

const first = (props: Record<string, string[]> | undefined, key: string) => props?.[key]?.[0];

// Pure: assemble one job from the timer's and service's `show` properties.
export function buildJob(
  timer: Record<string, string[]>,
  service: Record<string, string[]> | undefined,
  history: JobRun[],
  override: JobOverride = {}
): ScheduledJob {
  const id = first(timer, 'Id') ?? '';
  const calendars = calendarSpecs(timer.TimersCalendar);
  const monotonic = monotonicSpecs(timer.TimersMonotonic);
  const schedule = [
    ...calendars,
    ...monotonic.map(spec => `${spec.base.replace(/USec$/, 'Sec')}=${spec.span}`)
  ].join(' · ');
  const human =
    calendars.length > 0
      ? calendars.map(describeCalendar).join(' · ')
      : monotonic.map(spec => describeMonotonic(spec.base, spec.span)).join(' · ') || '—';

  const started = parseUnixStamp(first(service, 'ExecMainStartTimestamp'));
  const exited = parseUnixStamp(first(service, 'ExecMainExitTimestamp'));
  const active = first(service, 'ActiveState');
  const running =
    active === 'activating' || (active === 'active' && first(service, 'SubState') === 'running');
  const lastRun = history.at(-1);
  const result = first(service, 'Result');
  const lastResult = lastRun
    ? lastRun.ok
      ? 'success'
      : 'failed'
    : started
      ? result === 'success'
        ? 'success'
        : 'failed'
      : null;
  const duration =
    started && exited && exited >= started
      ? Math.round((new Date(exited).getTime() - new Date(started).getTime()) / 1000)
      : null;

  return {
    id,
    name: override.name?.trim() || first(timer, 'Description') || id,
    kind: override.kind ?? defaultKind(id),
    service: first(timer, 'Unit') ?? id.replace(/\.timer$/, '.service'),
    schedule,
    human,
    command: parseExecStart(first(service, 'ExecStart')),
    enabled: first(timer, 'ActiveState') === 'active',
    running,
    lastRunAt: lastRun?.at ?? parseUnixStamp(first(timer, 'LastTriggerUSec')) ?? started,
    lastDurationSec: running ? null : duration,
    lastResult,
    nextRunAt: parseUnixStamp(first(timer, 'NextElapseUSecRealtime')),
    history
  };
}

// Timer names from `systemctl list-units --type=timer --all --no-legend --plain`.
export function parseTimerList(output: string): string[] {
  return output
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(([name, load]) => name !== undefined && isTimerName(name) && load !== 'not-found')
    .map(([name]) => name as string);
}

// --- Collection ------------------------------------------------------------

const TIMER_PROPS = [
  'Id',
  'Description',
  'Unit',
  'ActiveState',
  'TimersCalendar',
  'TimersMonotonic',
  'LastTriggerUSec',
  'NextElapseUSecRealtime'
].join(',');
const SERVICE_PROPS = [
  'Id',
  'ActiveState',
  'SubState',
  'Result',
  'ExecMainStartTimestamp',
  'ExecMainExitTimestamp',
  'ExecStart'
].join(',');

async function readHistory(service: string): Promise<JobRun[]> {
  try {
    const output = await runArgs(
      'journalctl',
      ['-u', service, '-o', 'json', '--since', HISTORY_SINCE, '-n', JOURNAL_LIMIT, '--no-pager', '-q'],
      5000,
      16 * 1024 * 1024
    );
    return parseRunHistory(output);
  } catch {
    return [];
  }
}

export const listJobs = withTtl(30_000, async (): Promise<JobList> => {
  let timers: string[];
  try {
    timers = parseTimerList(
      await runArgs('systemctl', [
        'list-units',
        '--type=timer',
        '--all',
        '--no-legend',
        '--plain',
        '--no-pager'
      ])
    );
  } catch {
    return { available: false, jobs: [] };
  }

  const overrides = parseJobsConfig(process.env.JOBS_CONFIG);
  timers = timers.filter(timer => !overrides[timer]?.hidden);
  if (timers.length === 0) return { available: true, jobs: [] };

  let timerProps = new Map<string, Record<string, string[]>>();
  let serviceProps = new Map<string, Record<string, string[]>>();
  try {
    timerProps = parseShowBlocks(
      await runArgs('systemctl', ['show', '--timestamp=unix', '-p', TIMER_PROPS, '--', ...timers])
    );
    const services = [...timerProps.values()]
      .map(props => first(props, 'Unit'))
      .filter((unit): unit is string => unit !== undefined && UNIT_NAME.test(unit));
    if (services.length > 0) {
      serviceProps = parseShowBlocks(
        await runArgs('systemctl', ['show', '--timestamp=unix', '-p', SERVICE_PROPS, '--', ...services])
      );
    }
  } catch {
    return { available: false, jobs: [] };
  }

  const jobs = await Promise.all(
    timers.flatMap(timer => {
      const props = timerProps.get(timer);
      if (!props) return [];
      const service = first(props, 'Unit');
      return [
        (async () =>
          buildJob(
            props,
            service ? serviceProps.get(service) : undefined,
            service && UNIT_NAME.test(service) ? await readHistory(service) : [],
            overrides[timer]
          ))()
      ];
    })
  );

  // Backups first, then by name.
  jobs.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'backup' ? -1 : 1));
  return { available: true, jobs };
});
