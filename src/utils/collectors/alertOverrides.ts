import fs from 'fs';
import path from 'path';

// Lets an operator tune alert thresholds from the web UI (POST /api/alerts/config)
// without editing .env and restarting the process. An override here takes
// priority over the environment variable, which remains the effective default
// when no override is set. Persisted with the same atomic-write pattern as
// history.ts/alerts.ts so it survives a restart, but written synchronously
// (not debounced) since edits are rare, operator-initiated actions rather
// than a per-tick stream.

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.ALERT_OVERRIDES_FILE || path.join(DATA_DIR, 'alert-overrides.json');
const STORE_VERSION = 1;

interface ThresholdDef {
  key: string; // the ALERT_* environment variable name this overrides
  label: string;
  default: number;
  // Matches the Rule.direction of the alerts.ts rule this feeds, for
  // ENTER/CLEAR pairs: 'above' means enter > clear ("high is bad"), 'below'
  // means enter < clear ("low is bad"). Unused for thresholds with no
  // ENTER/CLEAR counterpart (see pairKeyFor below).
  direction: 'above' | 'below';
}

// Every threshold the web UI can edit. Kept in one place so the API route and
// alerts.ts's rule definitions can't drift apart on what's configurable.
export const CONFIGURABLE_THRESHOLDS: ThresholdDef[] = [
  { key: 'ALERT_CPU_ENTER', label: 'CPU enter (%)', default: 90, direction: 'above' },
  { key: 'ALERT_CPU_CLEAR', label: 'CPU clear (%)', default: 80, direction: 'above' },
  { key: 'ALERT_MEM_ENTER', label: 'Memory enter (%)', default: 90, direction: 'above' },
  { key: 'ALERT_MEM_CLEAR', label: 'Memory clear (%)', default: 80, direction: 'above' },
  { key: 'ALERT_DISK_ENTER', label: 'Disk enter (%)', default: 85, direction: 'above' },
  { key: 'ALERT_DISK_CLEAR', label: 'Disk clear (%)', default: 80, direction: 'above' },
  { key: 'ALERT_TEMP_ENTER', label: 'CPU temp enter (°C)', default: 74, direction: 'above' },
  { key: 'ALERT_TEMP_CLEAR', label: 'CPU temp clear (°C)', default: 70, direction: 'above' },
  { key: 'ALERT_SWAP_ENTER', label: 'Swap enter (%)', default: 80, direction: 'above' },
  { key: 'ALERT_SWAP_CLEAR', label: 'Swap clear (%)', default: 60, direction: 'above' },
  { key: 'ALERT_LOAD_ENTER', label: 'Load per core enter', default: 2, direction: 'above' },
  { key: 'ALERT_LOAD_CLEAR', label: 'Load per core clear', default: 1.5, direction: 'above' },
  { key: 'ALERT_GPU_TEMP_ENTER', label: 'GPU temp enter (°C)', default: 85, direction: 'above' },
  { key: 'ALERT_GPU_TEMP_CLEAR', label: 'GPU temp clear (°C)', default: 78, direction: 'above' },
  { key: 'ALERT_BATTERY_ENTER', label: 'Battery low enter (%)', default: 15, direction: 'below' },
  { key: 'ALERT_BATTERY_CLEAR', label: 'Battery recovered clear (%)', default: 25, direction: 'below' },
  { key: 'ALERT_DISKFILL_ENTER_HOURS', label: 'Disk fill enter (hours)', default: 24, direction: 'below' },
  { key: 'ALERT_DISKFILL_CLEAR_HOURS', label: 'Disk fill clear (hours)', default: 48, direction: 'below' },
  { key: 'ALERT_MEMFILL_ENTER_HOURS', label: 'Memory fill enter (hours)', default: 24, direction: 'below' },
  { key: 'ALERT_MEMFILL_CLEAR_HOURS', label: 'Memory fill clear (hours)', default: 48, direction: 'below' },
  // Composite memPressure rule: two independent thresholds (RAM and swap must
  // BOTH be exceeded), not an ENTER/CLEAR hysteresis pair — no pairKeyFor match.
  {
    key: 'ALERT_MEMPRESSURE_MEM',
    label: 'Memory pressure — RAM threshold (%)',
    default: 90,
    direction: 'above'
  },
  {
    key: 'ALERT_MEMPRESSURE_SWAP',
    label: 'Memory pressure — swap threshold (%)',
    default: 80,
    direction: 'above'
  }
];

const CONFIGURABLE_KEYS = new Set(CONFIGURABLE_THRESHOLDS.map(t => t.key));
export function isConfigurableThreshold(key: string): boolean {
  return CONFIGURABLE_KEYS.has(key);
}

const THRESHOLDS_BY_KEY = new Map(CONFIGURABLE_THRESHOLDS.map(t => [t.key, t]));

// ALERT_*_ENTER <-> ALERT_*_CLEAR, derived from the naming convention rather
// than a second hand-maintained list, so the two can't drift apart.
function pairKeyFor(key: string): string | null {
  if (key.includes('_ENTER')) return key.replace('_ENTER', '_CLEAR');
  if (key.includes('_CLEAR')) return key.replace('_CLEAR', '_ENTER');
  return null;
}

const overrides = new Map<string, number>();

let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { v: number; overrides: Record<string, number> };
    if (parsed && parsed.v === STORE_VERSION && parsed.overrides && typeof parsed.overrides === 'object') {
      for (const [key, value] of Object.entries(parsed.overrides)) {
        if (isConfigurableThreshold(key) && typeof value === 'number' && Number.isFinite(value)) {
          overrides.set(key, value);
        }
      }
    }
  } catch {
    // Missing/unreadable file: start with no overrides (env/defaults apply).
  }
}

function writeStoreSync(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = { v: STORE_VERSION, overrides: Object.fromEntries(overrides) };
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
    fs.renameSync(tmp, STORE_FILE);
  } catch {
    // A disk write failure isn't fatal: the override still applies in memory
    // for the life of this process, and the next successful edit retries the save.
  }
}

// Read by alerts.ts's num() on every evaluation (not cached), so a change here
// takes effect on the very next tick with no restart required.
export function getOverride(key: string): number | undefined {
  ensureLoaded();
  return overrides.get(key);
}

export function getAllOverrides(): Record<string, number> {
  ensureLoaded();
  return Object.fromEntries(overrides);
}

// Same precedence as alerts.ts's num(): a pending override, then the env
// var, then the threshold's own default.
function effectiveValue(key: string, fallback: number): number {
  ensureLoaded();
  const override = overrides.get(key);
  if (override !== undefined) return override;
  const raw = process.env[key];
  if (raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return fallback;
}

// True if setting `key` to `value` would make its ENTER/CLEAR pair invert
// the hysteresis relationship the rule relies on (enter > clear for
// direction 'above', enter < clear for 'below') — e.g. setting CPU clear
// above the current CPU enter. Compares against the pair key's current
// EFFECTIVE value (override, else env, else default), not just its default,
// so an already-customized pair is validated correctly. Keys with no
// ENTER/CLEAR counterpart (pairKeyFor returns null) are never flagged.
export function wouldInvertHysteresis(key: string, value: number): boolean {
  const def = THRESHOLDS_BY_KEY.get(key);
  const pairKey = pairKeyFor(key);
  if (!def || !pairKey) return false;
  const pairDef = THRESHOLDS_BY_KEY.get(pairKey);
  if (!pairDef) return false;

  const pairValue = effectiveValue(pairKey, pairDef.default);
  const isEnter = key.includes('_ENTER');
  const enterValue = isEnter ? value : pairValue;
  const clearValue = isEnter ? pairValue : value;

  return def.direction === 'above' ? !(enterValue > clearValue) : !(enterValue < clearValue);
}

export function setOverride(key: string, value: number): void {
  ensureLoaded();
  overrides.set(key, value);
  writeStoreSync();
}

export function clearOverride(key: string): void {
  ensureLoaded();
  if (overrides.delete(key)) writeStoreSync();
}
