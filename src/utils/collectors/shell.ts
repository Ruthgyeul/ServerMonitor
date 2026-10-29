import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';

import { logger } from '@/utils/logger';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// `ip`, `sensors`, `ps`, etc. are often installed in /usr/sbin or /sbin, but a
// systemd/pm2 service running as a non-root user has those paths missing from
// its PATH. The command then ends in "not found" and the metric drops to 0.
export const EXEC_ENV = {
  ...process.env,
  PATH: [process.env.PATH, '/usr/local/sbin', '/usr/sbin', '/sbin'].filter(Boolean).join(':'),
  LC_ALL: 'C', // if the locale makes the decimal separator ',', parseFloat truncates it
  LANG: 'C'
};

export async function run(command: string, timeout = 5000): Promise<string> {
  const { stdout } = await execAsync(command, { env: EXEC_ENV, timeout });
  return stdout.trim();
}

// Like run(), but without a shell: the arguments go to the program verbatim,
// so values that came from outside (unit or container names) can never be
// interpreted as shell syntax. Callers still validate names before passing them.
export async function runArgs(
  file: string,
  args: string[],
  timeout = 5000,
  maxBuffer = 4 * 1024 * 1024
): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { env: EXEC_ENV, timeout, maxBuffer });
  return stdout.trim();
}

// runArgs() for programs that write part of their output to stderr (docker
// logs replays a container's stderr there): both streams, kept separate.
export async function runArgsBoth(
  file: string,
  args: string[],
  timeout = 5000,
  maxBuffer = 4 * 1024 * 1024
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(file, args, { env: EXEC_ENV, timeout, maxBuffer });
  return { stdout, stderr };
}

export async function readSys(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, 'utf-8')).trim();
  } catch {
    return null;
  }
}

// If one collector fails, still return the rest of the metrics.
export async function collect<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T,
  warnings: string[]
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${name}: ${message}`);
    logger.warn(`collector ${name} failed:`, message);
    return fallback;
  }
}

// The dashboard polls once a second. Running process-spawning collectors like
// `who`, `last`, `nvidia-smi`, `smartctl`, `apt-get` every second would make the
// monitored server busier, so values that rarely change are cached for a TTL.
//
// Stale-while-revalidate: once a value exists, an expired entry returns the stale
// value immediately and refreshes in the background. Only the very first call
// (before any value exists) awaits the collector. This keeps a slow refresh
// (apt/SMART/journal, up to seconds) from blocking the 1s collection loop, since
// getSystemInfo awaits every collector before the next tick is scheduled.
//
// `.refresh()` collects now and waits for it — after a control action changed
// what the collector reads, so the next poll isn't served the old value.
export function withTtl<T>(
  ttlMs: number,
  fn: () => Promise<T>
): (() => Promise<T>) & { refresh: () => Promise<T> } {
  let value: T;
  let hasValue = false;
  let expiresAt = 0;
  let inflight: Promise<T> | null = null;

  const refresh = (): Promise<T> => {
    // Even if several collectors call within the same tick, spawn the process only once.
    if (inflight) return inflight;
    inflight = fn()
      .then(result => {
        value = result;
        hasValue = true;
        expiresAt = Date.now() + ttlMs;
        return result;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const get = async () => {
    if (hasValue && expiresAt > Date.now()) return value; // fresh
    if (hasValue) {
      // Stale: kick off a background refresh (swallow its error — the stale value
      // is still served) and return the last good value now.
      void refresh().catch(() => {});
      return value;
    }
    return refresh(); // no value yet: must await the first collection
  };
  return Object.assign(get, { refresh });
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function round(value: number, digits = 2): number {
  return parseFloat(value.toFixed(digits));
}
