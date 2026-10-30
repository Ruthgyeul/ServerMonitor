import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import { JobList, JobRun, ScheduledJob } from '@/types/system';
import { defaultKind, HISTORY_RUNS, type JobOverride } from '@/utils/collectors/jobConfig';
import { runArgs } from '@/utils/collectors/shell';

// Cron jobs for the Jobs page, next to the systemd timers: entries from
// /etc/crontab, /etc/cron.d/* and per-user crontabs (when readable), with the
// cron.hourly/daily/weekly/monthly scripts expanded from their run-parts line.
// Last run and duration come from cron's journal lines; the result is only
// known when cron logs it (e.g. Debian cron with -L 15), otherwise "unknown".
// Parsers are pure and exported for testing.

const SYSTEM_CRONTAB = '/etc/crontab';
const CRON_D = '/etc/cron.d';
const USER_CRONTABS = ['/var/spool/cron/crontabs', '/var/spool/cron'];
type PeriodicDir = 'hourly' | 'daily' | 'weekly' | 'monthly';
const JOURNAL_SINCE = '-45d';
const JOURNAL_LIMIT = '20000';

export interface CronEntry {
  schedule: string; // five fields or an @macro
  user: string;
  command: string;
  source: string; // "crontab (root)", "cron.d/certbot", …
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
};

// Pure: the lines of a crontab. System crontabs (/etc/crontab, cron.d) have a
// user column; per-user crontabs don't. Variable assignments and comments are skipped.
export function parseCrontab(
  content: string,
  options: { system: boolean; user?: string; source: string }
): CronEntry[] {
  const entries: CronEntry[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) continue;
    const parts = line.split(/\s+/);
    const macro = parts[0]?.startsWith('@');
    const scheduleFields = macro ? 1 : 5;
    const userField = options.system ? 1 : 0;
    if (parts.length < scheduleFields + userField + 1) continue;
    const schedule = parts.slice(0, scheduleFields).join(' ');
    if (macro && !(schedule in MACROS) && schedule !== '@reboot') continue;
    const user = options.system ? parts[scheduleFields] : (options.user ?? 'root');
    const command = parts.slice(scheduleFields + userField).join(' ');
    entries.push({ schedule, user: user ?? 'root', command, source: options.source });
  }
  return entries;
}

// Pure: the cron.<period> directory a run-parts line runs, if any.
export function periodicDir(command: string): PeriodicDir | null {
  const match = command.match(/run-parts\b[^;|&]*\/etc\/cron\.(hourly|daily|weekly|monthly)\b/);
  return match ? (match[1] as PeriodicDir) : null;
}

// --- Schedule maths ----------------------------------------------------------

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Pure: one cron field → the allowed values, or null if malformed.
export function expandField(
  field: string,
  min: number,
  max: number,
  names: string[] = []
): Set<number> | null {
  const values = new Set<number>();
  const toNumber = (token: string) => {
    const index = names.indexOf(token.toLowerCase());
    return index >= 0 ? index + min : Number(token);
  };
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step <= 0 || range === undefined) return null;
    let from: number;
    let to: number;
    if (range === '*') {
      from = min;
      to = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      from = toNumber(a ?? '');
      to = toNumber(b ?? '');
    } else {
      from = toNumber(range);
      to = stepRaw === undefined ? from : max;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

export function parseCronExpression(schedule: string): ParsedCron | null {
  const expression = MACROS[schedule] ?? schedule;
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const minutes = expandField(minute, 0, 59);
  const hours = expandField(hour, 0, 23);
  const days = expandField(day, 1, 31);
  const months = expandField(month, 1, 12, MONTH_NAMES);
  // 0 and 7 are both Sunday.
  const weekdaysRaw = expandField(weekday.replace(/\b7\b/g, '0'), 0, 6, DAY_NAMES);
  if (!minutes || !hours || !days || !months || !weekdaysRaw) return null;
  return {
    minutes,
    hours,
    days,
    months,
    weekdays: weekdaysRaw,
    dayRestricted: day !== '*',
    weekdayRestricted: weekday !== '*'
  };
}

// Pure: the next local time after `after` the schedule fires, or null
// (@reboot, malformed, or nothing within a year).
export function nextCronRun(schedule: string, after: number): number | null {
  const cron = parseCronExpression(schedule);
  if (!cron) return null;
  const date = new Date(after);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = after + 366 * 24 * 60 * 60 * 1000;
  while (date.getTime() <= limit) {
    const dayMatches =
      cron.dayRestricted && cron.weekdayRestricted
        ? cron.days.has(date.getDate()) || cron.weekdays.has(date.getDay())
        : cron.days.has(date.getDate()) && cron.weekdays.has(date.getDay());
    if (!cron.months.has(date.getMonth() + 1) || !dayMatches) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
      continue;
    }
    return date.getTime();
  }
  return null;
}

const pad = (value: number) => String(value).padStart(2, '0');

// Pure: a readable form, in the same style as the timer descriptions.
export function describeCron(schedule: string): string {
  if (schedule === '@reboot') return 'At boot';
  const expression = MACROS[schedule] ?? schedule;
  const fields = expression.split(/\s+/);
  if (fields.length !== 5) return schedule;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const everyMinutes = minute.match(/^\*\/(\d+)$/);
  if (everyMinutes && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return `Every ${Number(everyMinutes[1])} minutes`;
  }
  if (/^\d+(,\d+)+$/.test(minute) && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return `Hourly at ${minute
      .split(',')
      .map(value => `:${pad(Number(value))}`)
      .join(', ')}`;
  }
  if (!/^\d+$/.test(minute)) return schedule;
  if (hour === '*' && day === '*' && month === '*' && weekday === '*')
    return `Hourly at :${pad(Number(minute))}`;
  const everyHours = hour.match(/^\*\/(\d+)$/) ?? hour.match(/^0-23\/(\d+)$/);
  if (everyHours && day === '*' && month === '*' && weekday === '*')
    return `Every ${Number(everyHours[1])} hours`;
  if (!/^\d+(,\d+)*$/.test(hour) || month !== '*') return schedule;
  const hours = hour.split(',').map(Number);
  const times = hours.map(value => `${pad(value)}:${pad(Number(minute))}`).join(', ');
  if (day === '*' && weekday === '*') return hours.length === 2 ? 'Twice daily' : `Daily at ${times}`;
  if (day === '*' && /^[0-7]$/.test(weekday)) {
    const name = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(weekday) % 7];
    return `Weekly · ${name} ${times}`;
  }
  if (/^\d+$/.test(day) && weekday === '*') return `Monthly · day ${Number(day)} at ${times}`;
  return schedule;
}

// --- Run history from the journal -------------------------------------------

interface CronRecord {
  __REALTIME_TIMESTAMP?: string;
  MESSAGE?: string | number[];
  _PID?: string;
  SYSLOG_PID?: string;
}

interface CronRun {
  startedAt: number;
  endedAt: number | null;
  ok: boolean | null;
}

const messageOf = (record: CronRecord) =>
  Array.isArray(record.MESSAGE)
    ? Buffer.from(record.MESSAGE).toString('utf-8')
    : String(record.MESSAGE ?? '');

// Pure: cron's journal → runs per "(user) command", oldest first. A run
// starts at its CMD line; its end is the session close (or END line) from the
// same pid; it failed if cron logged a failure or non-zero exit for that pid.
export function parseCronRuns(output: string): Map<string, CronRun[]> {
  const runs = new Map<string, CronRun[]>();
  const byPid = new Map<string, CronRun>();
  for (const raw of output.split('\n')) {
    if (!raw.trim()) continue;
    let record: CronRecord;
    try {
      record = JSON.parse(raw) as CronRecord;
    } catch {
      continue;
    }
    const at = Math.floor(Number(record.__REALTIME_TIMESTAMP) / 1000);
    const pid = record._PID ?? record.SYSLOG_PID;
    if (!Number.isFinite(at) || !pid) continue;
    const message = messageOf(record);

    const started = message.match(/^\(([^)]+)\) CMD \((.*)\)$/);
    if (started) {
      const run: CronRun = { startedAt: at, endedAt: null, ok: null };
      const key = `${started[1]}\u0000${started[2].trim()}`;
      runs.set(key, [...(runs.get(key) ?? []), run]);
      byPid.set(pid, run);
      continue;
    }
    const run = byPid.get(pid);
    if (!run) continue;
    if (/FAILED|exit status [1-9]\d*|returned [1-9]\d*/i.test(message)) {
      run.ok = false;
      run.endedAt ??= at;
    } else if (/session closed|\) END \(|CMDEND/i.test(message)) {
      run.endedAt = at;
      if (/\) END \(|CMDEND/.test(message) && run.ok === null) run.ok = true;
    }
  }
  return runs;
}

// --- Assembly ----------------------------------------------------------------

export function cronJobId(entry: Pick<CronEntry, 'user' | 'schedule' | 'command'>): string {
  const hash = createHash('sha1').update(`${entry.user} ${entry.schedule} ${entry.command}`).digest('hex');
  return `cron:${entry.user}:${hash.slice(0, 10)}`;
}

// Shell plumbing around the real job: guards and steps that aren't the job
// itself, and words that lead into the command (control flow, wrappers).
const NOT_THE_JOB = new Set(['[', '[[', 'test', 'cd', 'true', 'false', ':', 'sleep', 'fi', 'done', 'esac']);
const LEADING_WORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  '!',
  '(',
  '{',
  'exec',
  'nice',
  'ionice',
  'env',
  'time'
]);

const unquote = (word: string) => word.replace(/^["'(]+|["');]+$/g, '');

// The program a command segment runs, skipping lead-in words, flags, numbers
// and VAR=value assignments.
function programOf(segment: string): string | null {
  for (const raw of segment.trim().split(/\s+/)) {
    const word = unquote(raw);
    if (!word || LEADING_WORDS.has(word) || word.startsWith('-') || /^\d+$/.test(word)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    return word;
  }
  return null;
}

// Pure: a short name — the basename of the first program in the command that
// isn't a guard (`[ -x /usr/lib/php/sessionclean ] && … sessionclean` →
// "sessionclean"), else the command's first word.
export function nameOf(command: string): string {
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const program = programOf(segment);
    if (program && !NOT_THE_JOB.has(program)) return path.basename(program) || program;
  }
  const first = unquote(command.trim().split(/\s+/)[0] ?? '');
  return path.basename(first) || command.slice(0, 40);
}

// Pure: one job from an entry, its runs and the clock.
export function buildCronJob(
  entry: CronEntry,
  runs: CronRun[],
  now: number,
  override: JobOverride = {},
  display: { name?: string; command?: string; source?: string } = {}
): ScheduledJob {
  const id = cronJobId(entry);
  const recent = runs.slice(-HISTORY_RUNS);
  const last = recent.at(-1);
  const history: JobRun[] = recent.map(run => ({
    at: new Date(run.endedAt ?? run.startedAt).toISOString(),
    ok: run.ok
  }));
  const running = Boolean(
    last && last.endedAt === null && now - last.startedAt < 6 * 60 * 60 * 1000 && last.ok === null
  );
  const next = nextCronRun(entry.schedule, now);
  const command = display.command ?? entry.command;
  return {
    id,
    name: override.name?.trim() || display.name || nameOf(command),
    kind: override.kind ?? defaultKind(command),
    source: display.source ?? entry.source,
    controllable: false,
    service: '',
    schedule: entry.schedule,
    human: describeCron(entry.schedule),
    command,
    enabled: true,
    running,
    lastRunAt: last ? new Date(last.endedAt ?? last.startedAt).toISOString() : null,
    lastRunStartedAt: last ? new Date(last.startedAt).toISOString() : null,
    invocationId: null,
    lastDurationSec:
      last && last.endedAt !== null ? Math.max(0, Math.round((last.endedAt - last.startedAt) / 1000)) : null,
    lastResult: last ? (last.ok === null ? 'unknown' : last.ok ? 'success' : 'failed') : null,
    nextRunAt: next === null ? null : new Date(next).toISOString(),
    history
  };
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, 'utf-8');
  } catch {
    return null;
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(dir)).filter(name => !name.startsWith('.') && !name.includes('~'));
  } catch {
    return [];
  }
}

async function readEntries(): Promise<{ entries: CronEntry[]; found: boolean }> {
  const entries: CronEntry[] = [];
  let found = false;
  const system = await readText(SYSTEM_CRONTAB);
  if (system !== null) {
    found = true;
    entries.push(...parseCrontab(system, { system: true, source: 'crontab (system)' }));
  }
  for (const name of await listDir(CRON_D)) {
    const content = await readText(path.join(CRON_D, name));
    if (content !== null) {
      found = true;
      entries.push(...parseCrontab(content, { system: true, source: `cron.d/${name}` }));
    }
  }
  for (const dir of USER_CRONTABS) {
    for (const user of await listDir(dir)) {
      const content = await readText(path.join(dir, user));
      if (content !== null) {
        found = true;
        entries.push(...parseCrontab(content, { system: false, user, source: `crontab (${user})` }));
      }
    }
  }
  return { entries, found };
}

async function readCronJournal(): Promise<Map<string, CronRun[]>> {
  try {
    const output = await runArgs(
      'journalctl',
      [
        '-t',
        'CRON',
        '-t',
        'cron',
        '-t',
        'crond',
        '-o',
        'json',
        '--since',
        JOURNAL_SINCE,
        '-n',
        JOURNAL_LIMIT,
        '--no-pager',
        '-q'
      ],
      8000,
      32 * 1024 * 1024
    );
    return parseCronRuns(output);
  } catch {
    return new Map();
  }
}

export async function listCronJobs(overrides: Record<string, JobOverride>): Promise<JobList> {
  const { entries, found } = await readEntries();
  if (!found) return { available: false, jobs: [] };
  const runs = await readCronJournal();
  const now = Date.now();
  const jobs: ScheduledJob[] = [];

  for (const entry of entries) {
    if (entry.schedule === '@reboot') continue;
    const entryRuns = runs.get(`${entry.user}\u0000${entry.command.trim()}`) ?? [];
    const period = periodicDir(entry.command);
    if (period) {
      // One job per script; they share the run-parts line's schedule and runs.
      for (const script of await listDir(`/etc/cron.${period}`)) {
        const scripted = { ...entry, command: `${entry.command} :: ${script}` };
        if (overrides[cronJobId(scripted)]?.hidden) continue;
        jobs.push(
          buildCronJob(scripted, entryRuns, now, overrides[cronJobId(scripted)], {
            name: script,
            command: `/etc/cron.${period}/${script}`,
            source: `cron.${period}`
          })
        );
      }
      continue;
    }
    if (overrides[cronJobId(entry)]?.hidden) continue;
    jobs.push(buildCronJob(entry, entryRuns, now, overrides[cronJobId(entry)]));
  }
  return { available: true, jobs };
}
