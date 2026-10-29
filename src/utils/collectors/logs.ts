import { LogLevel, LogLine, LogSourceKind } from '@/types/system';
import { isServiceUnitName } from '@/utils/collectors/services';
import { runArgs, runArgsBoth } from '@/utils/collectors/shell';

// Recent output of one systemd unit (journalctl) or one container (docker logs)
// for the log drawer. Names are validated and passed without a shell.

export const MAX_LOG_LINES = 1000;
export const DEFAULT_LOG_LINES = 300;

// Docker names: [a-zA-Z0-9][a-zA-Z0-9_.-]+ ; short/long ids are hex.
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function isContainerName(name: string): boolean {
  return CONTAINER_NAME.test(name);
}

export function isValidLogSource(kind: LogSourceKind, name: string): boolean {
  return kind === 'unit' ? isServiceUnitName(name) : isContainerName(name);
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

export async function readLogs(kind: LogSourceKind, name: string, count: number): Promise<LogLine[]> {
  const lines = Math.min(MAX_LOG_LINES, Math.max(1, Math.floor(count)));
  if (kind === 'unit') {
    const output = await runArgs(
      'journalctl',
      ['-u', name, '-n', String(lines), '-o', 'json', '--no-pager'],
      8000
    );
    return parseJournal(output);
  }
  const { stdout, stderr } = await runArgsBoth(
    'docker',
    ['logs', '--tail', String(lines), '--timestamps', name],
    8000
  );
  // A container's stderr comes back on our stderr; merge both streams in time order.
  return [...parseDockerLogs(stdout), ...parseDockerLogs(stderr)]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-lines);
}
