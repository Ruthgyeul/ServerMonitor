import fs from 'fs';
import path from 'path';

import { UptimeCheck, UptimeSample } from '@/types/system';
import { logger } from '@/utils/logger';
import { processSingleton } from '@/utils/processSingleton';

// HTTP uptime checks: GET each endpoint on its interval, keep the last 60
// results, persist to data/uptime.json. One service instance per process
// (kept on globalThis) so the background scheduler and the API routes share
// the same checks even when Next bundles them separately.

export const INTERVALS = [10, 30, 60, 300] as const;
export const HISTORY_LENGTH = 60;
export const TIMEOUT_MS = 10_000;
const MAX_CHECKS = 50;
const TICK_MS = 5_000;
const MAX_NAME = 60;

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.UPTIME_FILE || path.join(DATA_DIR, 'uptime.json');
const STORE_VERSION = 1;

export interface NewCheck {
  name: string;
  url: string;
  intervalSec: number;
}

// Pure: validate a new check, returning a message for the form or null.
export function validateCheck(input: Partial<NewCheck>): string | null {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a full URL, e.g. https://example.com/health';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return 'Only http and https URLs can be checked';
  if (parsed.username || parsed.password) return "Credentials in the URL aren't supported";
  if (typeof input.name === 'string' && input.name.trim().length > MAX_NAME)
    return `Name must be ${MAX_NAME} characters or fewer`;
  if (!INTERVALS.includes(input.intervalSec as (typeof INTERVALS)[number]))
    return 'Pick one of the listed intervals';
  return null;
}

// Pure: the display name when none was given — the URL's host.
export function defaultName(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Pure: is a check due at `now`?
export function isDue(check: UptimeCheck, now: number): boolean {
  if (check.paused) return false;
  const last = check.history.at(-1);
  return !last || now - new Date(last.at).getTime() >= check.intervalSec * 1000;
}

// One GET with a timeout. 2xx/3xx (after redirects) counts as up.
export async function probe(url: string, at: number = Date.now()): Promise<UptimeSample> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'ServerMonitor-uptime/1.0' }
    });
    void response.body?.cancel();
    const ms = Math.round(performance.now() - started);
    return {
      at: new Date(at).toISOString(),
      ok: response.status >= 200 && response.status < 400,
      ms,
      code: response.status
    };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return {
      at: new Date(at).toISOString(),
      ok: false,
      ms: null,
      code: null,
      error: timedOut ? 'timeout' : 'unreachable'
    };
  }
}

interface StoreShape {
  v: number;
  checks: UptimeCheck[];
}

type Listener = (check: UptimeCheck, sample: UptimeSample) => void;

class UptimeService {
  private checks: UptimeCheck[] = [];
  private inflight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    try {
      const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')) as StoreShape;
      if (parsed?.v === STORE_VERSION && Array.isArray(parsed.checks)) this.checks = parsed.checks;
    } catch {
      // first run
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.tick();
  }

  // Called after every probe (alerts subscribe to failures/recoveries).
  onResult(listener: Listener): void {
    this.listeners.add(listener);
  }

  list(): UptimeCheck[] {
    return this.checks.map(check => ({ ...check, history: [...check.history] }));
  }

  add(input: NewCheck): UptimeCheck | string {
    const problem = validateCheck(input);
    if (problem) return problem;
    if (this.checks.length >= MAX_CHECKS) return `At most ${MAX_CHECKS} checks`;
    const url = input.url.trim();
    const check: UptimeCheck = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim() || defaultName(url),
      url,
      intervalSec: input.intervalSec,
      paused: false,
      history: []
    };
    this.checks.push(check);
    this.save();
    void this.run(check);
    return check;
  }

  setPaused(id: string, paused: boolean): boolean {
    const check = this.checks.find(candidate => candidate.id === id);
    if (!check) return false;
    check.paused = paused;
    this.save();
    return true;
  }

  remove(id: string): boolean {
    const before = this.checks.length;
    this.checks = this.checks.filter(check => check.id !== id);
    if (this.checks.length === before) return false;
    this.save();
    return true;
  }

  async runNow(id: string): Promise<UptimeCheck | null> {
    const check = this.checks.find(candidate => candidate.id === id);
    if (!check) return null;
    await this.run(check);
    return { ...check, history: [...check.history] };
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    await Promise.all(this.checks.filter(check => isDue(check, now)).map(check => this.run(check)));
  }

  private async run(check: UptimeCheck): Promise<void> {
    if (this.inflight.has(check.id)) return;
    this.inflight.add(check.id);
    try {
      const sample = await probe(check.url);
      // The check may have been deleted while the request was in flight.
      if (!this.checks.includes(check)) return;
      check.history = [...check.history, sample].slice(-HISTORY_LENGTH);
      this.save();
      for (const listener of this.listeners) listener(check, sample);
    } catch (error) {
      logger.warn('uptime check failed to run:', error instanceof Error ? error.message : String(error));
    } finally {
      this.inflight.delete(check.id);
    }
  }

  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const payload: StoreShape = { v: STORE_VERSION, checks: this.checks };
      void fs.promises
        .mkdir(DATA_DIR, { recursive: true })
        .then(() => fs.promises.writeFile(`${STORE_FILE}.tmp`, JSON.stringify(payload), 'utf-8'))
        .then(() => fs.promises.rename(`${STORE_FILE}.tmp`, STORE_FILE))
        .catch(() => {
          /* retried on the next change */
        });
    }, 2000);
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }
}

export function uptime(): UptimeService {
  return processSingleton('uptime', () => new UptimeService());
}
