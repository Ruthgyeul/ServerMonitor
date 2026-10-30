import { LogLevel, LogLine, LogSourceKind } from '@/types/system';
import { isServiceUnitName } from '@/utils/collectors/services';
import { runArgs, runArgsBoth } from '@/utils/collectors/shell';

// Recent output of one systemd unit (journalctl) or one container (docker logs)
// for the log drawer, optionally narrowed to one run (a systemd invocation, or
// everything since a start time). Names are validated and passed without a shell.

export const MAX_LOG_LINES = 1000;
export const DEFAULT_LOG_LINES = 500;

// The drawer's payload: the lines, and whether the source can still produce more.
export interface LogTail {
  lines: LogLine[];
  active: boolean;
}

// Narrows a read to one run of a unit (Jobs → Output).
export interface LogScope {
  invocation?: string | null; // systemd InvocationID (32 hex digits)
  since?: number | null; // epoch ms
}

// Docker names: [a-zA-Z0-9][a-zA-Z0-9_.-]+ ; short/long ids are hex.
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function isContainerName(name: string): boolean {
  return CONTAINER_NAME.test(name);
}

export function isValidLogSource(kind: LogSourceKind, name: string): boolean {
  return kind === 'unit' ? isServiceUnitName(name) : isContainerName(name);
}

// systemd invocation ids are 128-bit, printed as 32 hex digits.
export function isInvocationId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

// Pure: a ?since= value (ISO 8601) → epoch ms, or null when it isn't a real
// time in the past few years (anything else is rejected, not clamped).
const MAX_SINCE_AGE_MS = 400 * 24 * 60 * 60 * 1000;
export function parseSince(raw: string | null, now: number = Date.now()): number | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(raw)) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > MAX_SINCE_AGE_MS) return null;
  return at;
}

// Pure: journalctl arguments for a unit's tail, one invocation, or a run since a time.
export function journalArgs(name: string, lines: number, scope: LogScope = {}): string[] {
  const output = ['-n', String(lines), '-o', 'json', '--no-pager'];
  if (scope.invocation) {
    // The run's own output, plus systemd's start/finish lines for it.
    const id = scope.invocation.toLowerCase();
    return [`_SYSTEMD_INVOCATION_ID=${id}`, '+', `INVOCATION_ID=${id}`, ...output];
  }
  const since = scope.since ? ['--since', `@${Math.floor(scope.since / 1000)}`] : [];
  return ['-u', name, ...since, ...output];
}

// Pure: `docker logs` arguments for a container's tail (or since a time).
export function dockerLogArgs(name: string, lines: number, scope: LogScope = {}): string[] {
  const since = scope.since ? ['--since', String(Math.floor(scope.since / 1000))] : [];
  return ['logs', '--tail', String(lines), '--timestamps', ...since, name];
}

// Pure: `systemctl is-active` output → whether the unit can still write output.
export function unitIsActive(state: string): boolean {
  return ['active', 'activating', 'reloading', 'deactivating'].includes(state.trim());
}

// journald priority: 0 emerg … 3 err, 4 warning, 5 notice, 6 info, 7 debug.
function levelOfPriority(priority: number): LogLevel {
  if (priority <= 3) return 'error';
  if (priority === 4) return 'warn';
  return 'info';
}

// Free text (container output) has no priority; guess from common markers.
export function levelOfText(message: string): LogLevel {
  if (/\b(error|err|fatal|panic|exception|failed)\b/i.test(message)) return 'error';
  if (/\b(warn|warning|deprecated)\b/i.test(message)) return 'warn';
  return 'info';
}

interface JournalEntry {
  __REALTIME_TIMESTAMP?: string;
  PRIORITY?: string;
  MESSAGE?: string | number[] | null;
}

// Pure: `journalctl -o json` (one object per line).
export function parseJournal(output: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of output.split('\n')) {
    if (!raw.trim()) continue;
    let entry: JournalEntry;
    try {
      entry = JSON.parse(raw) as JournalEntry;
    } catch {
      continue;
    }
    const micros = Number(entry.__REALTIME_TIMESTAMP);
    if (!Number.isFinite(micros)) continue;
    // Binary-safe messages arrive as a byte array.
    const message = Array.isArray(entry.MESSAGE)
      ? Buffer.from(entry.MESSAGE).toString('utf-8')
      : String(entry.MESSAGE ?? '');
    const priority = Number(entry.PRIORITY ?? 6);
    lines.push({
      at: new Date(Math.floor(micros / 1000)).toISOString(),
      level: levelOfPriority(Number.isFinite(priority) ? priority : 6),
      message
    });
  }
  return lines;
}

// Pure: `docker logs --timestamps` lines ("2026-10-29T12:00:00.123456789Z msg").
export function parseDockerLogs(output: string, forceLevel: LogLevel | null = null): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of output.split('\n')) {
    const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})\s?(.*)$/);
    if (!match) continue;
    const fraction = (match[2] ?? '').slice(0, 4); // keep milliseconds only
    const at = new Date(`${match[1]}${fraction}${match[3]}`);
    if (Number.isNaN(at.getTime())) continue;
    const message = match[4];
    lines.push({ at: at.toISOString(), level: forceLevel ?? levelOfText(message), message });
  }
  return lines;
}

export async function readLogs(
  kind: LogSourceKind,
  name: string,
  count: number,
  scope: LogScope = {}
): Promise<LogLine[]> {
  const lines = Math.min(MAX_LOG_LINES, Math.max(1, Math.floor(count)));
  if (kind === 'unit') {
    return parseJournal(await runArgs('journalctl', journalArgs(name, lines, scope), 8000));
  }
  const { stdout, stderr } = await runArgsBoth('docker', dockerLogArgs(name, lines, scope), 8000);
  // A container's stderr comes back on our stderr; merge both streams in time order.
  return [...parseDockerLogs(stdout), ...parseDockerLogs(stderr)]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-lines);
}

// Whether the unit is running / the container is up. Unknown counts as not
// active: the drawer then says no new output is expected.
export async function isLogSourceActive(kind: LogSourceKind, name: string): Promise<boolean> {
  try {
    if (kind === 'unit') return unitIsActive(await runArgs('systemctl', ['is-active', '--', name], 4000));
    const running = await runArgs('docker', ['inspect', '--format', '{{.State.Running}}', name], 4000);
    return running.trim() === 'true';
  } catch {
    // `systemctl is-active` exits non-zero for an inactive unit.
    return false;
  }
}

export async function readLogTail(
  kind: LogSourceKind,
  name: string,
  count: number,
  scope: LogScope = {}
): Promise<LogTail> {
  const [lines, active] = await Promise.all([
    readLogs(kind, name, count, scope),
    isLogSourceActive(kind, name)
  ]);
  return { lines, active };
}
