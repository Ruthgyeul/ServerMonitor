import fs from 'fs';
import path from 'path';

import { AlertEntry, AlertLevel, FirewallInfo, SshSession, TemperatureValue } from '@/types/system';
import { dispatchAlert } from '@/utils/collectors/notify';

const MAX_ENTRIES = 30;

// Thresholds can be overridden by environment variables. Unset uses the
// defaults below — an operator should be able to tune them to a host's
// characteristics without editing the source.
function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

// To keep a value hovering around the threshold from flooding the log, the
// enter value and clear value differ (hysteresis).
interface Rule {
  key: string;
  level: AlertLevel;
  enterAbove: number;
  clearBelow: number;
  onEnter: (value: number) => string;
  onClear: (value: number) => string;
}

const RULES: Rule[] = [
  {
    key: 'cpu',
    level: 'warning',
    enterAbove: num('ALERT_CPU_ENTER', 90),
    clearBelow: num('ALERT_CPU_CLEAR', 80),
    onEnter: value => `CPU usage ${value.toFixed(0)}%`,
    onClear: () => 'CPU usage back to normal'
  },
  {
    key: 'memory',
    level: 'warning',
    enterAbove: num('ALERT_MEM_ENTER', 90),
    clearBelow: num('ALERT_MEM_CLEAR', 80),
    onEnter: value => `Memory usage ${value.toFixed(0)}%`,
    onClear: () => 'Memory usage back to normal'
  },
  {
    key: 'disk',
    level: 'warning',
    enterAbove: num('ALERT_DISK_ENTER', 85),
    clearBelow: num('ALERT_DISK_CLEAR', 80),
    onEnter: value => `Disk usage crossed ${value.toFixed(0)}%`,
    onClear: () => 'Disk usage back to normal'
  },
  {
    key: 'temperature',
    level: 'critical',
    enterAbove: num('ALERT_TEMP_ENTER', 74),
    clearBelow: num('ALERT_TEMP_CLEAR', 70),
    onEnter: value => `CPU temp ${value.toFixed(1)}°C`,
    onClear: () => 'CPU temp back to normal'
  },
  {
    key: 'swap',
    level: 'warning',
    enterAbove: num('ALERT_SWAP_ENTER', 80),
    clearBelow: num('ALERT_SWAP_CLEAR', 60),
    onEnter: value => `Swap usage ${value.toFixed(0)}%`,
    onClear: () => 'Swap usage back to normal'
  }
];

// How often (minutes) to re-notify while a breach persists. 0 (default)
// disables re-notification. This never floods the on-screen log — it re-notifies
// via the external webhook only.
const RENOTIFY_MS = num('ALERT_RENOTIFY_MINUTES', 0) * 60 * 1000;

const active = new Set<string>();
const log: AlertEntry[] = [];
let knownSessions: Set<string> | null = null;
let knownFirewall: FirewallInfo['status'] | null = null;
let knownIfaceDown: Set<string> | null = null;
let sequence = 0;
// Per-rule last external-notify time. Used for the re-notify cooldown.
const lastNotifiedAt = new Map<string, number>();

// --- Disk persistence ----------------------------------------------------
// Until now the alert log lived only in process memory and was lost on restart.
// Persist it to data/alerts.json the same way as history.json, so recent alerts
// survive a redeploy/crash.
const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.ALERTS_FILE || path.join(DATA_DIR, 'alerts.json');
const STORE_VERSION = 1;

interface StoreShape {
  v: number;
  log: AlertEntry[];
}

let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed && parsed.v === STORE_VERSION && Array.isArray(parsed.log)) {
      // Stored newest-first, so restore as-is but honor the cap.
      for (const entry of parsed.log.slice(0, MAX_ENTRIES)) log.push(entry);
    }
  } catch {
    // If the file is missing (first run) or unreadable, start empty.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
const SAVE_INTERVAL_MS = 5000;

async function writeStore(): Promise<void> {
  if (writing) return;
  writing = true;
  const payload: StoreShape = { v: STORE_VERSION, log };
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // A disk write failure is not fatal. Retry on the next save.
  } finally {
    writing = false;
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeStore();
  }, SAVE_INTERVAL_MS);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

// On a shutdown signal, write the final state synchronously once more. Even if
// the scheduled save hasn't run yet, recent alerts aren't lost (same as history.ts).
function flushSync(): void {
  try {
    const payload: StoreShape = { v: STORE_VERSION, log };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload), 'utf-8');
  } catch {
    // Swallow failures during shutdown.
  }
}

let exitHooked = false;
function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.once('SIGTERM', () => flushSync());
  process.once('SIGINT', () => flushSync());
  process.once('beforeExit', () => flushSync());
}

// --- Log / notify --------------------------------------------------------

// firstEvaluation: at the very first evaluation right after the process starts,
// an already-breached value or already-attached SSH/firewall state isn't pushed
// out as if it "just happened". It's still written to the on-screen log (so the
// operator sees the current state) but the webhook notify is skipped.
function push(level: AlertLevel, message: string, at: number, notify: boolean): void {
  sequence += 1;
  const entry: AlertEntry = { id: `${at}-${sequence}`, level, message, at: new Date(at).toISOString() };
  log.unshift(entry);
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
  scheduleSave();

  if (notify) void dispatchAlert(entry);
}

export interface AlertInput {
  cpu: number;
  memory: number;
  disk: number;
  swap: number;
  temperature: TemperatureValue;
  firewall: FirewallInfo['status'];
  sshSessions: SshSession[];
  // For interface-down detection. Only the name and state are needed (optional: old-input compatible).
  interfaces?: { name: string; state: 'up' | 'down' | 'unknown' }[];
}

export function evaluateAlerts(input: AlertInput, at: number = Date.now()): AlertEntry[] {
  ensureLoaded();
  hookExit();

  const firstEvaluation = knownSessions === null && knownFirewall === null && knownIfaceDown === null;
  const values: Record<string, number | null> = {
    cpu: input.cpu,
    memory: input.memory,
    disk: input.disk,
    swap: input.swap,
    temperature: input.temperature === 'N/A' ? null : input.temperature
  };

  for (const rule of RULES) {
    const value = values[rule.key];
    if (value === null || Number.isNaN(value)) continue;

    if (!active.has(rule.key) && value > rule.enterAbove) {
      active.add(rule.key);
      lastNotifiedAt.set(rule.key, at);
      push(rule.level, rule.onEnter(value), at, !firstEvaluation);
    } else if (active.has(rule.key) && value < rule.clearBelow) {
      active.delete(rule.key);
      lastNotifiedAt.delete(rule.key);
      push('ok', rule.onClear(value), at, !firstEvaluation);
    } else if (active.has(rule.key) && RENOTIFY_MS > 0) {
      // While the breach persists, re-notify (external webhook only, doesn't flood the on-screen log).
      const last = lastNotifiedAt.get(rule.key) ?? 0;
      if (at - last >= RENOTIFY_MS) {
        lastNotifiedAt.set(rule.key, at);
        void dispatchAlert({
          id: `${at}-renotify-${rule.key}`,
          level: rule.level,
          message: `${rule.onEnter(value)} (still)`,
          at: new Date(at).toISOString()
        });
      }
    }
  }

  // Record only newly appeared SSH sessions. On the first evaluation, quietly
  // remember the already-attached sessions instead of dumping them as fresh
  // logins. The key is user@ip only. Including `since` would make the same
  // session reprint as a new login whenever the timestamp jitters slightly
  // (spam), so record it once for the life of the session.
  const sessionKeys = new Set(input.sshSessions.map(s => `${s.user}@${s.ip}`));
  if (knownSessions === null) {
    knownSessions = sessionKeys;
  } else {
    for (const session of input.sshSessions) {
      const key = `${session.user}@${session.ip}`;
      if (!knownSessions.has(key)) push('info', `SSH login: ${session.user}@${session.ip}`, at, true);
    }
    knownSessions = sessionKeys;
  }

  // Interface-down transitions. up->down is a warning, down->up is a clear.
  if (input.interfaces) {
    const downNow = new Set(input.interfaces.filter(i => i.state === 'down').map(i => i.name));
    if (knownIfaceDown === null) {
      knownIfaceDown = downNow;
    } else {
      for (const name of downNow) {
        if (!knownIfaceDown.has(name)) push('warning', `Interface ${name} down`, at, true);
      }
      for (const name of knownIfaceDown) {
        if (!downNow.has(name)) push('ok', `Interface ${name} back up`, at, true);
      }
      knownIfaceDown = downNow;
    }
  } else if (knownIfaceDown === null) {
    // If interface info isn't available yet, initialize to an empty set so the first-evaluation flag isn't left unconsumed.
    knownIfaceDown = new Set();
  }

  if (input.firewall !== 'unknown' && input.firewall !== knownFirewall) {
    if (knownFirewall !== null) {
      push(input.firewall === 'active' ? 'ok' : 'critical', `Firewall ${input.firewall}`, at, true);
    }
    knownFirewall = input.firewall;
  }

  return [...log];
}
