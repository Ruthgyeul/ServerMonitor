import fs from 'fs';
import path from 'path';

import {
  ActiveAlert,
  AlertEntry,
  AlertLevel,
  AlertThreshold,
  AlertTiming,
  FirewallInfo,
  PendingAlert,
  SshSession,
  TemperatureValue
} from '@/types/system';
import { dispatchAlert, webhookWouldSend } from '@/utils/collectors/notify';
import { isMuted } from '@/utils/collectors/alertMute';
import { getOverride } from '@/utils/collectors/alertOverrides';
import { incidents } from '@/utils/collectors/incidents';
import { processSingleton } from '@/utils/processSingleton';

// The recent view streamed with every /api/system response (kept small so the
// SSE payload stays light). The dashboard alert card reads this.
const MAX_ENTRIES = 30;

// Thresholds can be overridden by environment variables, or at runtime via the
// web UI (POST /api/alerts/config -> alertOverrides.ts), which takes priority
// over the environment variable. Unset uses the defaults below — an operator
// should be able to tune them to a host's characteristics without editing the
// source. Called fresh on every rule evaluation (see Rule.enter/clear below),
// not memoized, so a runtime override takes effect on the very next tick.
function num(key: string, fallback: number): number {
  const override = getOverride(key);
  if (override !== undefined) return override;
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
  // Shown next to the alert: the setting that governs it.
  source: string;
  label: string;
  // Unit of the value and threshold ("%", "°C", "h", "" for load per core);
  // undefined for yes/no rules (anomaly, memory pressure) that have no number to show.
  unit?: string;
  level: AlertLevel;
  direction: 'above' | 'below';
  // Functions, not plain numbers, so a threshold read fresh from num() on
  // every evaluation — including a runtime override set after this RULES
  // array was built — is honored without a process restart.
  enter: () => number;
  clear: () => number;
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
    source: 'ALERT_CPU_ENTER',
    label: 'CPU',
    unit: '%',
    level: 'warning',
    direction: 'above',
    enter: () => num('ALERT_CPU_ENTER', 90),
    clear: () => num('ALERT_CPU_CLEAR', 80),
    onEnter: value => `CPU usage ${value.toFixed(0)}%`,
    onClear: () => 'CPU usage back to normal'
  },
  {
    key: 'memory',
    source: 'ALERT_MEM_ENTER',
    label: 'Memory',
    unit: '%',
    level: 'warning',
    direction: 'above',
    enter: () => num('ALERT_MEM_ENTER', 90),
    clear: () => num('ALERT_MEM_CLEAR', 80),
    onEnter: value => `Memory usage ${value.toFixed(0)}%`,
    onClear: () => 'Memory usage back to normal'
  },
  {
    key: 'disk',
    source: 'ALERT_DISK_ENTER',
    label: 'Disk',
    unit: '%',
    level: 'warning',
    direction: 'above',
    enter: () => num('ALERT_DISK_ENTER', 85),
    clear: () => num('ALERT_DISK_CLEAR', 80),
    onEnter: value => `Disk usage crossed ${value.toFixed(0)}%`,
    onClear: () => 'Disk usage back to normal'
  },
  {
    key: 'temperature',
    source: 'ALERT_TEMP_ENTER',
    label: 'CPU temp',
    unit: '°C',
    level: 'critical',
    direction: 'above',
    enter: () => num('ALERT_TEMP_ENTER', 74),
    clear: () => num('ALERT_TEMP_CLEAR', 70),
    onEnter: value => `CPU temp ${value.toFixed(1)}°C`,
    onClear: () => 'CPU temp back to normal'
  },
  {
    key: 'swap',
    source: 'ALERT_SWAP_ENTER',
    label: 'Swap',
    unit: '%',
    level: 'warning',
    direction: 'above',
    enter: () => num('ALERT_SWAP_ENTER', 80),
    clear: () => num('ALERT_SWAP_CLEAR', 60),
    onEnter: value => `Swap usage ${value.toFixed(0)}%`,
    onClear: () => 'Swap usage back to normal'
  },
  // Load relative to core count — a portable "is the box overloaded" signal.
  {
    key: 'loadPerCore',
    source: 'ALERT_LOAD_ENTER',
    label: 'Load',
    unit: '',
    level: 'warning',
    direction: 'above',
    enter: () => num('ALERT_LOAD_ENTER', 2),
    clear: () => num('ALERT_LOAD_CLEAR', 1.5),
    compute: v => v.loadPerCore,
    onEnter: value => `Load ${value.toFixed(2)} per core`,
    onClear: () => 'Load back to normal'
  },
  {
    key: 'gpuTemp',
    source: 'ALERT_GPU_TEMP_ENTER',
    label: 'GPU temp',
    unit: '°C',
    level: 'critical',
    direction: 'above',
    enter: () => num('ALERT_GPU_TEMP_ENTER', 85),
    clear: () => num('ALERT_GPU_TEMP_CLEAR', 78),
    compute: v => v.gpuTemp,
    onEnter: value => `GPU temp ${value.toFixed(1)}°C`,
    onClear: () => 'GPU temp back to normal'
  },
  // "low is bad": battery charge dropping.
  {
    key: 'battery',
    source: 'ALERT_BATTERY_ENTER',
    label: 'Battery',
    unit: '%',
    level: 'warning',
    direction: 'below',
    enter: () => num('ALERT_BATTERY_ENTER', 15),
    clear: () => num('ALERT_BATTERY_CLEAR', 25),
    compute: v => v.battery,
    onEnter: value => `Battery low ${value.toFixed(0)}%`,
    onClear: () => 'Battery recovered'
  },
  // "low is bad": estimated hours until the disk fills.
  {
    key: 'diskFill',
    source: 'ALERT_DISKFILL_ENTER_HOURS',
    label: 'Disk fill',
    unit: 'h',
    level: 'warning',
    direction: 'below',
    enter: () => num('ALERT_DISKFILL_ENTER_HOURS', 24),
    clear: () => num('ALERT_DISKFILL_CLEAR_HOURS', 48),
    compute: v => v.diskFill,
    // A null forecast means the disk is no longer filling → treat as recovered.
    nullMeans: 'recovered',
    onEnter: value => `Disk fills in ~${value.toFixed(0)}h at the current rate`,
    onClear: () => 'Disk fill rate eased'
  },
  // "low is bad": estimated hours until memory fills, mirroring diskFill.
  {
    key: 'memFill',
    source: 'ALERT_MEMFILL_ENTER_HOURS',
    label: 'Memory fill',
    unit: 'h',
    level: 'warning',
    direction: 'below',
    enter: () => num('ALERT_MEMFILL_ENTER_HOURS', 24),
    clear: () => num('ALERT_MEMFILL_CLEAR_HOURS', 48),
    compute: v => v.memFill,
    // A null forecast means memory is no longer trending toward full.
    nullMeans: 'recovered',
    onEnter: value => `Memory fills in ~${value.toFixed(0)}h at the current rate (possible leak)`,
    onClear: () => 'Memory fill rate eased'
  },
  // Statistical anomaly (opt-in via ALERT_ANOMALY_ENABLE): CPU far from its own
  // recent baseline even if under the absolute threshold. Passed in as a boolean.
  {
    key: 'cpuAnomaly',
    source: 'ALERT_ANOMALY_ENABLE',
    label: 'CPU anomaly',
    level: 'warning',
    direction: 'above',
    enter: () => 0.5,
    clear: () => 0.5,
    when: () => ANOMALY_ENABLED,
    compute: v => v.cpuAnomaly,
    onEnter: () => 'CPU usage anomalous vs its recent baseline',
    onClear: () => 'CPU usage back near baseline'
  },
  // Same idea, mirrored for memory (same opt-in flag).
  {
    key: 'memAnomaly',
    source: 'ALERT_ANOMALY_ENABLE',
    label: 'Memory anomaly',
    level: 'warning',
    direction: 'above',
    enter: () => 0.5,
    clear: () => 0.5,
    when: () => ANOMALY_ENABLED,
    compute: v => v.memAnomaly,
    onEnter: () => 'Memory usage anomalous vs its recent baseline',
    onClear: () => 'Memory usage back near baseline'
  },
  // Composite: RAM and swap both high at once — thrashing, distinct from either
  // individual warning. Modelled as a boolean (1/0) so it flows through the same
  // enter/clear machinery.
  {
    key: 'memPressure',
    source: 'ALERT_MEMPRESSURE_MEM',
    label: 'Memory pressure',
    level: 'critical',
    direction: 'above',
    enter: () => 0.5,
    clear: () => 0.5,
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

// The engine's mutable state, shared by every bundle in the process (see
// processSingleton) so the background loop and the stream's loop evaluate one
// set of alerts instead of each firing — and notifying — on their own.
const state = processSingleton('alerts', () => ({
  // Rules currently in the breached state, keyed by rule key. The message is
  // refreshed every tick so the bell/sidebar show the live value, while `since`
  // stays at the moment the rule entered.
  active: new Map<string, ActiveAlert>(),
  log: [] as AlertEntry[],
  knownSessions: null as Set<string> | null,
  knownFirewall: null as FirewallInfo['status'] | null,
  // When the firewall last changed state, so an inactive firewall reports how long it has been down.
  firewallSince: 0,
  knownIfaceDown: null as Set<string> | null,
  knownPortScanIps: null as Set<string> | null,
  sequence: 0,
  // Per-rule last external-notify time. Used for the re-notify cooldown.
  lastNotifiedAt: new Map<string, number>(),
  // Per-rule recent transition timestamps and current flapping state.
  transitions: new Map<string, number[]>(),
  flapping: new Set<string>(),
  // Rules breached but still inside the fire delay: key → when the breach began.
  pending: new Map<string, { since: number; level: AlertLevel; message: string; short?: string }>(),
  // Active rules recovered but still inside the resolve delay: key → when recovery began.
  recovering: new Map<string, number>(),
  // Breaches that ended inside the fire delay, since this process started.
  suppressedSpikes: 0,
  // External conditions' recovery messages, kept from when they fired.
  externalRecovery: new Map<string, string>(),
  externalPrimed: false,
  loaded: false,
  saveTimer: null as ReturnType<typeof setTimeout> | null,
  writing: false,
  exitHooked: false
}));
const { active, log, lastNotifiedAt, transitions, flapping, pending, recovering, externalRecovery } = state;

// Alert timing (design defaults: fire after 30s, clear after 60s; 0 = off). A
// threshold breach must hold for the fire delay before it alerts; shorter breaches are logged as suppressed
// spikes. An active alert must stay recovered for the resolve delay before it
// clears. Read fresh each tick so the rules page applies without a restart.
const MAX_DELAY_SECONDS = 3600;
const DEFAULT_DELAY_SECONDS: Record<string, number> = {
  ALERT_FIRE_DELAY_SECONDS: 30,
  ALERT_RESOLVE_DELAY_SECONDS: 60
};
function delayMs(key: string): number {
  return Math.min(Math.max(0, num(key, DEFAULT_DELAY_SECONDS[key] ?? 0)), MAX_DELAY_SECONDS) * 1000;
}

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

function ensureLoaded(): void {
  if (state.loaded) return;
  state.loaded = true;
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

const SAVE_INTERVAL_MS = 5000;

async function writeStore(): Promise<void> {
  if (state.writing) return;
  state.writing = true;
  const payload: StoreShape = { v: STORE_VERSION, log };
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // A disk write failure is not fatal. Retry on the next save.
  } finally {
    state.writing = false;
  }
}

function scheduleSave(): void {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    void writeStore();
  }, SAVE_INTERVAL_MS);
  if (typeof state.saveTimer.unref === 'function') state.saveTimer.unref();
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

function hookExit(): void {
  if (state.exitHooked) return;
  state.exitHooked = true;
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
  state.sequence += 1;
  const entry: AlertEntry = { id: `${at}-${state.sequence}`, level, message, at: new Date(at).toISOString() };
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
  // Currently-flagged port-scan source IPs (see security.ts). Optional: old-input compatible.
  portScanSuspects?: { ip: string; distinctPorts: number; hits: number }[];
  // Added for the expanded rule set (all optional: old-input compatible).
  cores?: number;
  loadAvg1?: number;
  gpuTemp?: TemperatureValue;
  battery?: number | null;
  diskHoursToFull?: number | null;
  memHoursToFull?: number | null;
  // Precomputed anomaly flags (see anomaly.ts); undefined = not evaluated.
  cpuAnomaly?: boolean;
  memAnomaly?: boolean;
}

function toNumber(value: TemperatureValue | number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function evaluateAlerts(input: AlertInput, at: number = Date.now()): AlertEntry[] {
  ensureLoaded();
  hookExit();

  const firstEvaluation =
    state.knownSessions === null && state.knownFirewall === null && state.knownIfaceDown === null;
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
    memFill: input.memHoursToFull ?? null,
    cpuAnomaly: input.cpuAnomaly === undefined ? null : input.cpuAnomaly ? 1 : 0,
    memAnomaly: input.memAnomaly === undefined ? null : input.memAnomaly ? 1 : 0
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

  const fireDelay = delayMs('ALERT_FIRE_DELAY_SECONDS');
  const resolveDelay = delayMs('ALERT_RESOLVE_DELAY_SECONDS');

  for (const rule of RULES) {
    if (rule.when && !rule.when(values)) continue;
    const raw = rule.compute ? rule.compute(values) : values[rule.key];
    const value = raw === null || raw === undefined || Number.isNaN(raw) ? null : raw;
    // Normally a null value means the source is temporarily unavailable, so we
    // hold the current state. For rules where null means "no longer breached"
    // (e.g. disk-fill forecast disappears when the disk stops filling), treat
    // it as recovered so an active alert isn't stuck and can re-fire later.
    if (value === null && rule.nullMeans !== 'recovered') continue;

    if (!active.has(rule.key)) {
      const wait = pending.get(rule.key);
      if (value !== null && breached(rule.direction, value, rule.enter())) {
        const since = wait?.since ?? at;
        if (firstEvaluation || at - since >= fireDelay) {
          pending.delete(rule.key);
          const flap = recordTransition(rule.key, at);
          fireAlert(
            rule.key,
            rule.level,
            rule.onEnter(value),
            rule.source,
            at,
            !firstEvaluation && !flap,
            flap,
            describeRule(rule, value)
          );
          announceFlap(rule, flap, at, firstEvaluation);
        } else {
          pending.set(rule.key, {
            since,
            level: rule.level,
            message: rule.onEnter(value),
            short: describeRule(rule, value).short
          });
        }
      } else if (wait) {
        // The breach ended inside the fire delay: a short spike, not an alert.
        pending.delete(rule.key);
        state.suppressedSpikes += 1;
        const seconds = Math.max(1, Math.round((at - wait.since) / 1000));
        push(
          'info',
          `Suppressed short spike: ${wait.message} for ${seconds}s (under ${fireDelay / 1000}s)`,
          at,
          false,
          rule.key
        );
      }
    } else if (value === null || recovered(rule.direction, value, rule.clear())) {
      const since = recovering.get(rule.key) ?? at;
      if (at - since >= resolveDelay) {
        const flap = recordTransition(rule.key, at);
        resolveAlert(rule.key, rule.onClear(value ?? rule.clear()), at, !firstEvaluation && !flap);
        announceFlap(rule, flap, at, firstEvaluation);
      } else {
        recovering.set(rule.key, since);
      }
    } else {
      recovering.delete(rule.key);
      if (RENOTIFY_MS > 0 && !flapping.has(rule.key) && value !== null) {
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

    const current = active.get(rule.key);
    if (current && value !== null) {
      current.message = rule.onEnter(value);
      current.short = describeRule(rule, value).short;
    }
  }

  // Record only newly appeared SSH sessions. On the first evaluation, quietly
  // remember the already-attached sessions instead of dumping them as fresh
  // logins. The key is user@ip only. Including `since` would make the same
  // session reprint as a new login whenever the timestamp jitters slightly
  // (spam), so record it once for the life of the session.
  const sessionKeys = new Set(input.sshSessions.map(s => `${s.user}@${s.ip}`));
  if (state.knownSessions === null) {
    state.knownSessions = sessionKeys;
  } else {
    for (const session of input.sshSessions) {
      const key = `${session.user}@${session.ip}`;
      if (!state.knownSessions.has(key))
        push('info', `SSH login: ${session.user}@${session.ip}`, at, true, 'ssh');
    }
    state.knownSessions = sessionKeys;
  }

  // Interface-down transitions. up->down is a warning, down->up is a clear.
  if (input.interfaces) {
    const downNow = new Set(input.interfaces.filter(i => i.state === 'down').map(i => i.name));
    if (state.knownIfaceDown === null) {
      state.knownIfaceDown = downNow;
    } else {
      for (const name of downNow) {
        if (!state.knownIfaceDown.has(name)) push('warning', `Interface ${name} down`, at, true, 'interface');
      }
      for (const name of state.knownIfaceDown) {
        if (!downNow.has(name)) push('ok', `Interface ${name} back up`, at, true, 'interface');
      }
      state.knownIfaceDown = downNow;
    }
  } else if (state.knownIfaceDown === null) {
    // If interface info isn't available yet, initialize to an empty set so the first-evaluation flag isn't left unconsumed.
    state.knownIfaceDown = new Set();
  }

  // Port-scan suspects: alert only when an IP NEWLY appears in the flagged
  // list, and drop it from "known" the moment it's no longer flagged — so a
  // scan that stops and later resumes alerts again instead of staying
  // silently suppressed forever (same idiom as the interface-down handling above).
  if (input.portScanSuspects) {
    const currentIps = new Set(input.portScanSuspects.map(suspect => suspect.ip));
    if (state.knownPortScanIps === null) {
      // Unlike the SSH-session/interface-down precedent above (which stays
      // silent about state already present at startup), log — but don't
      // externally notify — any suspect already active on the first
      // evaluation: a scan already underway when this process starts is
      // security-relevant enough that it shouldn't be swallowed just
      // because it isn't a fresh transition.
      for (const suspect of input.portScanSuspects) {
        push(
          'warning',
          `Possible port scan from ${suspect.ip} (${suspect.distinctPorts} ports)`,
          at,
          false,
          'portscan'
        );
      }
      state.knownPortScanIps = currentIps;
    } else {
      for (const suspect of input.portScanSuspects) {
        if (!state.knownPortScanIps.has(suspect.ip)) {
          push(
            'warning',
            `Possible port scan from ${suspect.ip} (${suspect.distinctPorts} ports)`,
            at,
            true,
            'portscan'
          );
        }
      }
      state.knownPortScanIps = currentIps;
    }
  } else if (state.knownPortScanIps === null) {
    state.knownPortScanIps = new Set();
  }

  if (input.firewall !== 'unknown' && input.firewall !== state.knownFirewall) {
    if (state.knownFirewall !== null) {
      push(
        input.firewall === 'active' ? 'ok' : 'critical',
        `Firewall ${input.firewall}`,
        at,
        true,
        'firewall'
      );
      if (input.firewall === 'inactive') {
        incidents().open(
          {
            key: 'firewall',
            level: 'critical',
            title: 'Firewall inactive',
            rule: 'firewall status',
            notifyText: notifyText('critical', 'firewall', at, true, false)
          },
          at
        );
      } else {
        incidents().autoResolve('firewall', at);
      }
    }
    state.knownFirewall = input.firewall;
    state.firewallSince = at;
  }

  // Return only the recent view for the dashboard/SSE; the full history is read
  // separately via getAlertLog() (/api/alerts).
  return log.slice(0, MAX_ENTRIES);
}

// Everything breached right now (threshold rules plus an inactive firewall),
// most severe first. Event alerts (SSH login, port scan, interface flaps) are
// point-in-time and live only in the log.
export function getActiveAlerts(): ActiveAlert[] {
  const list = [...active.values()].map(alert => ({ ...alert }));
  if (state.knownFirewall === 'inactive') {
    list.push({
      key: 'firewall',
      level: 'critical',
      message: 'Firewall inactive',
      since: new Date(state.firewallSince).toISOString(),
      rule: 'firewall status'
    });
  }
  const rank: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
  return list.sort((a, b) => rank[a.level] - rank[b.level] || a.since.localeCompare(b.since));
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

// What the incident timeline says about the notification for a firing.
function notifyText(level: AlertLevel, key: string, at: number, notify: boolean, flap: boolean): string {
  if (flap) return 'Not notified: the rule is flapping';
  if (!notify) return 'Not notified: already breached when monitoring started';
  if (isMuted(key, at)) return 'Notification suppressed (muted)';
  return webhookWouldSend(level) ? 'Notified webhook' : 'No notification channels enabled';
}

interface AlertDescription {
  short: string;
  ruleText: string;
  threshold: AlertThreshold | null;
}

const formatNumber = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

// Pure: compact text for a threshold rule at a value — "CPU 95% > 90%" and
// "cpu > 90%". Yes/no rules (no unit) fall back to their message and env key.
function describeRule(rule: Rule, value: number): AlertDescription {
  if (rule.unit === undefined) return { short: rule.onEnter(value), ruleText: rule.source, threshold: null };
  const enter = rule.enter();
  const op = rule.direction === 'above' ? '>' : '<';
  return {
    short: `${rule.label} ${formatNumber(value)}${rule.unit} ${op} ${formatNumber(enter)}${rule.unit}`,
    ruleText: `${rule.key} ${op} ${formatNumber(enter)}${rule.unit}`,
    threshold: { value: enter, unit: rule.unit }
  };
}

function fireAlert(
  key: string,
  level: AlertLevel,
  message: string,
  rule: string,
  at: number,
  notify: boolean,
  flap = false,
  description: AlertDescription = { short: message, ruleText: rule, threshold: null }
): void {
  active.set(key, { key, level, message, since: new Date(at).toISOString(), rule, ...description });
  lastNotifiedAt.set(key, at);
  push(level, message, at, notify, key);
  incidents().open(
    {
      key,
      level,
      title: message,
      rule,
      threshold: description.threshold,
      notifyText: notifyText(level, key, at, notify, flap)
    },
    at
  );
}

function resolveAlert(key: string, message: string, at: number, notify: boolean): void {
  active.delete(key);
  lastNotifiedAt.delete(key);
  recovering.delete(key);
  push('ok', message, at, notify, key);
  incidents().autoResolve(key, at);
}

// A condition from outside the metric rules: an HTTP check, a scheduled job or
// a systemd unit that is failing right now.
export interface ExternalCondition {
  key: string; // namespaced: http:<id>, job:<timer>, svc:<unit>
  level: AlertLevel;
  message: string;
  recoveredMessage: string;
  rule: string;
  short?: string; // "API down"; defaults to the message
}

const EXTERNAL_PREFIXES = ['http:', 'job:', 'svc:'];
const isExternalKey = (key: string) => EXTERNAL_PREFIXES.some(prefix => key.startsWith(prefix));

// Called once per tick with every external condition failing now. These fire
// and resolve right away (no fire/resolve delay — each source already debounces
// by its own interval). Conditions already failing at the first call after
// start are recorded without paging, like the metric rules.
export function evaluateExternal(failing: ExternalCondition[], at: number = Date.now()): void {
  ensureLoaded();
  const notify = state.externalPrimed;
  state.externalPrimed = true;
  const current = new Set(failing.map(condition => condition.key));

  for (const condition of failing) {
    const existing = active.get(condition.key);
    if (existing) {
      existing.message = condition.message;
      continue;
    }
    externalRecovery.set(condition.key, condition.recoveredMessage);
    fireAlert(condition.key, condition.level, condition.message, condition.rule, at, notify, false, {
      short: condition.short ?? condition.message,
      ruleText: condition.rule,
      threshold: null
    });
  }
  for (const key of [...active.keys()]) {
    if (!isExternalKey(key) || current.has(key)) continue;
    resolveAlert(key, externalRecovery.get(key) ?? `${key} recovered`, at, notify);
    externalRecovery.delete(key);
  }
}

// Breaches waiting out the fire delay and alerts waiting out the resolve delay.
export function getPendingAlerts(at: number = Date.now()): PendingAlert[] {
  const fireDelay = delayMs('ALERT_FIRE_DELAY_SECONDS');
  const resolveDelay = delayMs('ALERT_RESOLVE_DELAY_SECONDS');
  const waiting: PendingAlert[] = [...pending.entries()].map(([key, wait]) => ({
    key,
    level: wait.level,
    message: wait.message,
    short: wait.short,
    state: 'pending',
    since: new Date(wait.since).toISOString(),
    dueAt: new Date(wait.since + fireDelay).toISOString()
  }));
  for (const [key, since] of recovering) {
    const alert = active.get(key);
    if (!alert) continue;
    waiting.push({
      key,
      level: alert.level,
      message: alert.message,
      state: 'recovering',
      since: new Date(since).toISOString(),
      dueAt: new Date(Math.max(since + resolveDelay, at)).toISOString()
    });
  }
  return waiting;
}

export function getAlertTiming(): AlertTiming {
  return {
    fireDelaySec: delayMs('ALERT_FIRE_DELAY_SECONDS') / 1000,
    resolveDelaySec: delayMs('ALERT_RESOLVE_DELAY_SECONDS') / 1000,
    suppressedSpikes: state.suppressedSpikes
  };
}

// Audit trail for control actions (src/utils/control.ts): logged on screen and
// in the persisted history, never sent to the webhook.
export function logControlAction(message: string, ok: boolean, at: number = Date.now()): void {
  ensureLoaded();
  push(ok ? 'info' : 'warning', `Control: ${message}`, at, false, 'control');
}

// Something that happened on the host worth a line in the alert history
// (e.g. a container that exited), without notifying anyone.
export function logHostEvent(message: string, key: string, at: number = Date.now()): void {
  ensureLoaded();
  push('info', message, at, false, key);
}
