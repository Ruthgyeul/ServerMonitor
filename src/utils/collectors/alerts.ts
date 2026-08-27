import fs from 'fs';
import path from 'path';

import { AlertEntry, AlertLevel, FirewallInfo, SshSession, TemperatureValue } from '@/types/system';
import { dispatchAlert } from '@/utils/collectors/notify';
import { isMuted } from '@/utils/collectors/alertMute';

// The recent view streamed with every /api/system response (kept small so the
// SSE payload stays light). The dashboard alert card reads this.
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

// A threshold rule. `direction` chooses whether "bad" is high or low:
//   above  → enter when value > enter, clear when value < clear ("high is bad")
//   below  → enter when value < enter, clear when value > clear ("low is bad")
// The enter/clear gap is hysteresis, to stop a value hovering at the threshold
// from flooding. `compute` derives the value from the metric bag (for ratios or
// composite conditions); when absent, values[key] is used. `when`, if given,
// gates the rule so it only evaluates while the predicate holds.
type Values = Record<string, number | null>;

interface Rule {
  key: string;
  label: string;
  level: AlertLevel;
  direction: 'above' | 'below';
  enter: number;
  clear: number;
  onEnter: (value: number) => string;
  onClear: (value: number) => string;
  compute?: (values: Values) => number | null;
  when?: (values: Values) => boolean;
  // How to treat a null computed value while the rule is active. Default is
  // 'skip' (source temporarily unavailable). 'recovered' means null == no longer
  // breached (e.g. disk-fill forecast becomes null when the disk stops filling),
  // so an active alert should clear rather than stay stuck.
  nullMeans?: 'recovered';
}

function breached(direction: Rule['direction'], value: number, enter: number): boolean {
  return direction === 'above' ? value > enter : value < enter;
}

function recovered(direction: Rule['direction'], value: number, clear: number): boolean {
  return direction === 'above' ? value < clear : value > clear;
}

const RULES: Rule[] = [
  {
    key: 'cpu',
    label: 'CPU',
    level: 'warning',
    direction: 'above',
    enter: num('ALERT_CPU_ENTER', 90),
    clear: num('ALERT_CPU_CLEAR', 80),
    onEnter: value => `CPU usage ${value.toFixed(0)}%`,
    onClear: () => 'CPU usage back to normal'
  },
  {
    key: 'memory',
    label: 'Memory',
    level: 'warning',
    direction: 'above',
    enter: num('ALERT_MEM_ENTER', 90),
    clear: num('ALERT_MEM_CLEAR', 80),
    onEnter: value => `Memory usage ${value.toFixed(0)}%`,
    onClear: () => 'Memory usage back to normal'
  },
  {
    key: 'disk',
    label: 'Disk',
    level: 'warning',
    direction: 'above',
    enter: num('ALERT_DISK_ENTER', 85),
    clear: num('ALERT_DISK_CLEAR', 80),
    onEnter: value => `Disk usage crossed ${value.toFixed(0)}%`,
    onClear: () => 'Disk usage back to normal'
  },
  {
    key: 'temperature',
    label: 'CPU temp',
    level: 'critical',
    direction: 'above',
    enter: num('ALERT_TEMP_ENTER', 74),
    clear: num('ALERT_TEMP_CLEAR', 70),
    onEnter: value => `CPU temp ${value.toFixed(1)}°C`,
    onClear: () => 'CPU temp back to normal'
  },
  {
    key: 'swap',
    label: 'Swap',
    level: 'warning',
    direction: 'above',
    enter: num('ALERT_SWAP_ENTER', 80),
    clear: num('ALERT_SWAP_CLEAR', 60),
    onEnter: value => `Swap usage ${value.toFixed(0)}%`,
    onClear: () => 'Swap usage back to normal'
  },
  // Load relative to core count — a portable "is the box overloaded" signal.
  {
    key: 'loadPerCore',
    label: 'Load',
    level: 'warning',
    direction: 'above',
    enter: num('ALERT_LOAD_ENTER', 2),
    clear: num('ALERT_LOAD_CLEAR', 1.5),
    compute: v => v.loadPerCore,
    onEnter: value => `Load ${value.toFixed(2)} per core`,
    onClear: () => 'Load back to normal'
  },
  {
    key: 'gpuTemp',
    label: 'GPU temp',
    level: 'critical',
    direction: 'above',
    enter: num('ALERT_GPU_TEMP_ENTER', 85),
    clear: num('ALERT_GPU_TEMP_CLEAR', 78),
    compute: v => v.gpuTemp,
    onEnter: value => `GPU temp ${value.toFixed(1)}°C`,
    onClear: () => 'GPU temp back to normal'
  },
  // "low is bad": battery charge dropping.
  {
    key: 'battery',
    label: 'Battery',
    level: 'warning',
    direction: 'below',
    enter: num('ALERT_BATTERY_ENTER', 15),
    clear: num('ALERT_BATTERY_CLEAR', 25),
    compute: v => v.battery,
    onEnter: value => `Battery low ${value.toFixed(0)}%`,
    onClear: () => 'Battery recovered'
  },
  // "low is bad": estimated hours until the disk fills.
  {
    key: 'diskFill',
    label: 'Disk fill',
    level: 'warning',
    direction: 'below',
    enter: num('ALERT_DISKFILL_ENTER_HOURS', 24),
    clear: num('ALERT_DISKFILL_CLEAR_HOURS', 48),
    compute: v => v.diskFill,
    // A null forecast means the disk is no longer filling → treat as recovered.
    nullMeans: 'recovered',
    onEnter: value => `Disk fills in ~${value.toFixed(0)}h at the current rate`,
    onClear: () => 'Disk fill rate eased'
  },
  // Statistical anomaly (opt-in via ALERT_ANOMALY_ENABLE): CPU far from its own
  // recent baseline even if under the absolute threshold. Passed in as a boolean.
  {
    key: 'cpuAnomaly',
    label: 'CPU anomaly',
    level: 'warning',
    direction: 'above',
    enter: 0.5,
    clear: 0.5,
    when: () => ANOMALY_ENABLED,
    compute: v => v.cpuAnomaly,
    onEnter: () => 'CPU usage anomalous vs its recent baseline',
    onClear: () => 'CPU usage back near baseline'
  },
  // Composite: RAM and swap both high at once — thrashing, distinct from either
  // individual warning. Modelled as a boolean (1/0) so it flows through the same
  // enter/clear machinery.
  {
    key: 'memPressure',
    label: 'Memory pressure',
    level: 'critical',
    direction: 'above',
    enter: 0.5,
    clear: 0.5,
    compute: v =>
      v.memory === null || v.swap === null
        ? null
        : v.memory > num('ALERT_MEMPRESSURE_MEM', 90) && v.swap > num('ALERT_MEMPRESSURE_SWAP', 80)
          ? 1
          : 0,
    onEnter: () => 'Memory pressure: RAM and swap both high',
    onClear: () => 'Memory pressure eased'
  }
];

// How often (minutes) to re-notify while a breach persists. 0 (default)
// disables re-notification. This never floods the on-screen log — it re-notifies
// via the external webhook only.
const RENOTIFY_MS = num('ALERT_RENOTIFY_MINUTES', 0) * 60 * 1000;

// Flapping suppression: if a rule enters/clears too many times in a short
// window, stop paging for it (the on-screen log still records) until it settles.
const FLAP_WINDOW_MS = num('ALERT_FLAP_WINDOW_MINUTES', 10) * 60 * 1000;
const FLAP_THRESHOLD = num('ALERT_FLAP_THRESHOLD', 6);

// Anomaly detection is opt-in — it can be noisy on a bursty host.
const ANOMALY_ENABLED = /^(1|true|yes)$/i.test(process.env.ALERT_ANOMALY_ENABLE ?? '');

// The persisted history the /alerts page reads is deeper than the SSE view: a
// burst (or flapping) easily exceeds 30 entries within the 48h timeline window.
const HISTORY_MAX = num('ALERT_HISTORY_MAX', 500);
const HISTORY_RETENTION_MS = num('ALERT_HISTORY_RETENTION_DAYS', 7) * 24 * 60 * 60 * 1000;

const active = new Set<string>();
const log: AlertEntry[] = [];
let knownSessions: Set<string> | null = null;
let knownFirewall: FirewallInfo['status'] | null = null;
let knownIfaceDown: Set<string> | null = null;
let sequence = 0;
// Per-rule last external-notify time. Used for the re-notify cooldown.
const lastNotifiedAt = new Map<string, number>();
// Per-rule recent transition timestamps and current flapping state.
const transitions = new Map<string, number[]>();
const flapping = new Set<string>();

// Record an enter/clear transition and report whether the rule is now flapping.
function recordTransition(key: string, at: number): boolean {
  const times = transitions.get(key) ?? [];
  times.push(at);
  while (times.length > 0 && at - times[0] > FLAP_WINDOW_MS) times.shift();
  transitions.set(key, times);
  return times.length >= FLAP_THRESHOLD;
}

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
      // Stored newest-first, so restore as-is but honor the history cap.
      for (const entry of parsed.log.slice(0, HISTORY_MAX)) log.push(entry);
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
//
// key: the rule/event key, consulted for per-key muting. A muted event still
// logs on screen; only the outbound webhook is suppressed.
function push(
  level: AlertLevel,
  message: string,
  at: number,
  notify: boolean,
  key: string | null = null
): void {
  sequence += 1;
  const entry: AlertEntry = { id: `${at}-${sequence}`, level, message, at: new Date(at).toISOString() };
  log.unshift(entry);
  pruneHistory(at);
  scheduleSave();

  if (notify && !isMuted(key, at)) void dispatchAlert(entry);
}

// Keep the persisted history within its cap and retention window. log is
// newest-first, so stale entries collect at the tail.
function pruneHistory(now: number): void {
  if (log.length > HISTORY_MAX) log.length = HISTORY_MAX;
  const oldest = now - HISTORY_RETENTION_MS;
  while (log.length > 0 && new Date(log[log.length - 1].at).getTime() < oldest) log.pop();
}

// The full persisted alert log (newest first), for the /alerts history page.
export function getAlertLog(): AlertEntry[] {
  ensureLoaded();
  return [...log];
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
  // Added for the expanded rule set (all optional: old-input compatible).
  cores?: number;
  loadAvg1?: number;
  gpuTemp?: TemperatureValue;
  battery?: number | null;
  diskHoursToFull?: number | null;
  // Precomputed CPU anomaly flag (see anomaly.ts); undefined = not evaluated.
  cpuAnomaly?: boolean;
}

function toNumber(value: TemperatureValue | number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function evaluateAlerts(input: AlertInput, at: number = Date.now()): AlertEntry[] {
  ensureLoaded();
  hookExit();

  const firstEvaluation = knownSessions === null && knownFirewall === null && knownIfaceDown === null;
  const loadPerCore =
    input.loadAvg1 !== undefined && input.cores && input.cores > 0 ? input.loadAvg1 / input.cores : null;
  const values: Values = {
    cpu: input.cpu,
    memory: input.memory,
    disk: input.disk,
    swap: input.swap,
    temperature: toNumber(input.temperature),
    loadPerCore,
    gpuTemp: toNumber(input.gpuTemp),
    battery: input.battery ?? null,
    diskFill: input.diskHoursToFull ?? null,
    cpuAnomaly: input.cpuAnomaly === undefined ? null : input.cpuAnomaly ? 1 : 0
  };

  // Expire flapping for rules that have settled (no transitions left within the
  // window). Without this, a rule that flapped and then stayed breached would
  // suppress its re-notifications forever, since flapping was only re-evaluated
  // on a transition.
  for (const key of [...flapping]) {
    const times = transitions.get(key) ?? [];
    while (times.length > 0 && at - times[0] > FLAP_WINDOW_MS) times.shift();
    transitions.set(key, times);
    if (times.length < FLAP_THRESHOLD) flapping.delete(key);
  }

  for (const rule of RULES) {
    if (rule.when && !rule.when(values)) continue;
    const value = rule.compute ? rule.compute(values) : values[rule.key];
    if (value === null || value === undefined || Number.isNaN(value)) {
      // Normally a null value means the source is temporarily unavailable, so we
      // hold the current state. For rules where null means "no longer breached"
      // (e.g. disk-fill forecast disappears when the disk stops filling), clear
      // an active alert so it isn't stuck and can re-fire later.
      if (rule.nullMeans === 'recovered' && active.has(rule.key)) {
        active.delete(rule.key);
        lastNotifiedAt.delete(rule.key);
        const flap = recordTransition(rule.key, at);
        push('ok', rule.onClear(rule.clear), at, !firstEvaluation && !flap, rule.key);
        announceFlap(rule, flap, at, firstEvaluation);
      }
      continue;
    }

    if (!active.has(rule.key) && breached(rule.direction, value, rule.enter)) {
      active.add(rule.key);
      lastNotifiedAt.set(rule.key, at);
      const flap = recordTransition(rule.key, at);
      push(rule.level, rule.onEnter(value), at, !firstEvaluation && !flap, rule.key);
      announceFlap(rule, flap, at, firstEvaluation);
    } else if (active.has(rule.key) && recovered(rule.direction, value, rule.clear)) {
      active.delete(rule.key);
      lastNotifiedAt.delete(rule.key);
      const flap = recordTransition(rule.key, at);
      push('ok', rule.onClear(value), at, !firstEvaluation && !flap, rule.key);
      announceFlap(rule, flap, at, firstEvaluation);
    } else if (active.has(rule.key) && RENOTIFY_MS > 0 && !flapping.has(rule.key)) {
      // While the breach persists, re-notify (external webhook only, doesn't flood the on-screen log).
      const last = lastNotifiedAt.get(rule.key) ?? 0;
      if (at - last >= RENOTIFY_MS && !isMuted(rule.key, at)) {
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
      if (!knownSessions.has(key)) push('info', `SSH login: ${session.user}@${session.ip}`, at, true, 'ssh');
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
        if (!knownIfaceDown.has(name)) push('warning', `Interface ${name} down`, at, true, 'interface');
      }
      for (const name of knownIfaceDown) {
        if (!downNow.has(name)) push('ok', `Interface ${name} back up`, at, true, 'interface');
      }
      knownIfaceDown = downNow;
    }
  } else if (knownIfaceDown === null) {
    // If interface info isn't available yet, initialize to an empty set so the first-evaluation flag isn't left unconsumed.
    knownIfaceDown = new Set();
  }

  if (input.firewall !== 'unknown' && input.firewall !== knownFirewall) {
    if (knownFirewall !== null) {
      push(
        input.firewall === 'active' ? 'ok' : 'critical',
        `Firewall ${input.firewall}`,
        at,
        true,
        'firewall'
      );
    }
    knownFirewall = input.firewall;
  }

  // Return only the recent view for the dashboard/SSE; the full history is read
  // separately via getAlertLog() (/api/alerts).
  return log.slice(0, MAX_ENTRIES);
}

// Emit a one-time notice when a rule starts or stops flapping.
function announceFlap(rule: Rule, flap: boolean, at: number, firstEvaluation: boolean): void {
  if (flap && !flapping.has(rule.key)) {
    flapping.add(rule.key);
    push('info', `${rule.label} is flapping; suppressing its notifications`, at, !firstEvaluation, rule.key);
  } else if (!flap && flapping.has(rule.key)) {
    flapping.delete(rule.key);
  }
}
