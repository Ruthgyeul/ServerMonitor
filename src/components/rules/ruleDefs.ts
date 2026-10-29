import type { DashboardData } from '@/utils/dashboardData';

// The threshold rules as the Alert rules page shows them: one row per rule,
// each backed by a pair of configurable env keys (see alertOverrides.ts).

export type RuleDirection = 'above' | 'below' | 'pair';

export interface RuleDef {
  id: string;
  label: string;
  unit: string; // '%', '°C', 'h' or '' (a plain ratio)
  direction: RuleDirection;
  enterKey: string;
  clearKey: string;
  // Key of this rule in activeAlerts, so a firing rule is highlighted.
  alertKey: string;
  // The live value the rule compares, or null when unavailable.
  current: (data: DashboardData) => number | null;
  // What "now" says when there is no value (default "no sensor").
  missing?: string;
}

const num = (value: number | 'N/A' | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const RULE_DEFS: RuleDef[] = [
  {
    id: 'cpu',
    label: 'CPU usage',
    unit: '%',
    direction: 'above',
    enterKey: 'ALERT_CPU_ENTER',
    clearKey: 'ALERT_CPU_CLEAR',
    alertKey: 'cpu',
    current: d => d.cpu.usage
  },
  {
    id: 'mem',
    label: 'Memory usage',
    unit: '%',
    direction: 'above',
    enterKey: 'ALERT_MEM_ENTER',
    clearKey: 'ALERT_MEM_CLEAR',
    alertKey: 'memory',
    current: d => d.memory.percentage
  },
  {
    id: 'disk',
    label: 'Disk usage',
    unit: '%',
    direction: 'above',
    enterKey: 'ALERT_DISK_ENTER',
    clearKey: 'ALERT_DISK_CLEAR',
    alertKey: 'disk',
    current: d => d.disk.percentage
  },
  {
    id: 'temp',
    label: 'CPU temperature',
    unit: '°C',
    direction: 'above',
    enterKey: 'ALERT_TEMP_ENTER',
    clearKey: 'ALERT_TEMP_CLEAR',
    alertKey: 'temperature',
    current: d => num(d.cpu.temperature)
  },
  {
    id: 'swap',
    label: 'Swap usage',
    unit: '%',
    direction: 'above',
    enterKey: 'ALERT_SWAP_ENTER',
    clearKey: 'ALERT_SWAP_CLEAR',
    alertKey: 'swap',
    current: d => (d.swap.total > 0 ? d.swap.percentage : null),
    missing: 'off'
  },
  {
    id: 'load',
    label: 'Load per core',
    unit: '',
    direction: 'above',
    enterKey: 'ALERT_LOAD_ENTER',
    clearKey: 'ALERT_LOAD_CLEAR',
    alertKey: 'loadPerCore',
    current: d => (d.cpu.cores > 0 ? d.load.avg1 / d.cpu.cores : null)
  },
  {
    id: 'gpuTemp',
    label: 'GPU temperature',
    unit: '°C',
    direction: 'above',
    enterKey: 'ALERT_GPU_TEMP_ENTER',
    clearKey: 'ALERT_GPU_TEMP_CLEAR',
    alertKey: 'gpuTemp',
    current: d => num(d.gpu.temperature)
  },
  {
    id: 'battery',
    label: 'Battery low',
    unit: '%',
    direction: 'below',
    enterKey: 'ALERT_BATTERY_ENTER',
    clearKey: 'ALERT_BATTERY_CLEAR',
    alertKey: 'battery',
    current: d => d.battery?.percentage ?? null,
    missing: 'no battery'
  },
  {
    id: 'diskFill',
    label: 'Disk fill forecast',
    unit: 'h',
    direction: 'below',
    enterKey: 'ALERT_DISKFILL_ENTER_HOURS',
    clearKey: 'ALERT_DISKFILL_CLEAR_HOURS',
    alertKey: 'diskFill',
    current: d => d.disk.hoursToFull,
    missing: 'not filling'
  },
  {
    id: 'memFill',
    label: 'Memory fill forecast',
    unit: 'h',
    direction: 'below',
    enterKey: 'ALERT_MEMFILL_ENTER_HOURS',
    clearKey: 'ALERT_MEMFILL_CLEAR_HOURS',
    alertKey: 'memFill',
    current: d => d.memory.hoursToFull,
    missing: 'not filling'
  },
  {
    id: 'memPressure',
    label: 'Memory pressure',
    unit: '%',
    direction: 'pair',
    enterKey: 'ALERT_MEMPRESSURE_MEM',
    clearKey: 'ALERT_MEMPRESSURE_SWAP',
    alertKey: 'memPressure',
    current: d => d.memory.percentage
  }
];

// Row heading: "CPU usage (%)", "Disk fill forecast (hours)".
export function ruleTitle(rule: RuleDef): string {
  if (!rule.unit || rule.direction === 'pair') return rule.label;
  return `${rule.label} (${rule.unit === 'h' ? 'hours' : rule.unit})`;
}

// The env names shown under the heading.
export function ruleKeys(rule: RuleDef): string {
  if (rule.direction === 'pair') return `${rule.enterKey} / _SWAP`;
  const shared = rule.enterKey.replace(/_ENTER(_HOURS)?$/, '');
  return rule.enterKey.endsWith('_HOURS')
    ? `${shared}_ENTER_HOURS / CLEAR_HOURS`
    : `${shared}_ENTER / _CLEAR`;
}

// The live value as text: "now 23.4%", "now no sensor".
export function formatCurrent(rule: RuleDef, value: number | null): string {
  if (value === null) return `now ${rule.missing ?? 'no sensor'}`;
  const text = rule.unit === '' ? value.toFixed(2) : value.toFixed(1);
  return `now ${text}${rule.unit === 'h' ? 'h' : rule.unit}`;
}

// Draft check before saving: both numbers, non-negative, and ordered so the
// hysteresis band can't invert (which would make the alert flap).
export function validateRule(rule: RuleDef, enterText: string, clearText: string): string | null {
  const enter = Number(enterText);
  const clear = Number(clearText);
  if (
    enterText.trim() === '' ||
    clearText.trim() === '' ||
    !Number.isFinite(enter) ||
    !Number.isFinite(clear)
  ) {
    return 'Values must be numbers.';
  }
  if (enter < 0 || clear < 0) return 'Values must be non-negative numbers.';
  if (rule.direction === 'above' && !(enter > clear))
    return 'Enter must be greater than Clear, or the alert would flap.';
  if (rule.direction === 'below' && !(enter < clear))
    return 'Enter must be lower than Clear for a low-is-bad rule.';
  return null;
}

// The server rejects any single write that would invert the band, so when both
// values move, write the one that widens the band first.
export function saveOrder(rule: RuleDef, currentEnter: number, nextEnter: number): ('enter' | 'clear')[] {
  if (rule.direction === 'pair') return ['enter', 'clear'];
  const widensFirst = rule.direction === 'above' ? nextEnter >= currentEnter : nextEnter <= currentEnter;
  return widensFirst ? ['enter', 'clear'] : ['clear', 'enter'];
}
