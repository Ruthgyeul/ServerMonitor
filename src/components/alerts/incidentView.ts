import { PALETTE } from '@/lib/theme';
import type { AlertThreshold, MetricWindow, WindowMetric } from '@/types/system';
import type { Incident, IncidentEvent, IncidentStatus } from '@/utils/collectors/incidents';

// Pure presentation for incidents: status pills, compact durations and the
// metric context chart around an incident.

export const INCIDENTS_URL = '/api/incidents';

export const STATUS_STYLE: Record<IncidentStatus, { label: string; fg: string; bg: string }> = {
  open: { label: 'Open', fg: PALETTE.critFg, bg: 'rgba(239,95,90,0.14)' },
  acknowledged: { label: 'Acknowledged', fg: PALETTE.warnFg, bg: 'rgba(232,180,69,0.12)' },
  resolved: { label: 'Resolved', fg: PALETTE.okFg, bg: 'rgba(60,207,145,0.1)' }
};

// "45s", "12m", "3h 5m", "2d 4h".
export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function incidentDuration(incident: Incident, now: number): number {
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now;
  return end - new Date(incident.openedAt).getTime();
}

// The incident an active alert's "Incident →" link opens, per alert key: the
// unresolved one when there is one, else the most recent for that key (an
// alert can outlive a manually resolved incident). Incidents arrive newest first.
export function incidentByKey(incidents: Incident[]): Map<string, Incident> {
  const open = new Map<string, Incident>();
  const latest = new Map<string, Incident>();
  for (const incident of incidents) {
    if (!latest.has(incident.key)) latest.set(incident.key, incident);
    if (incident.status !== 'resolved' && !open.has(incident.key)) open.set(incident.key, incident);
  }
  for (const [key, incident] of latest) if (!open.has(key)) open.set(key, incident);
  return open;
}

// --- Metric context ------------------------------------------------------

interface ContextDef {
  metric: WindowMetric;
  label: string;
  unit: string;
  // Env key of the threshold, for incidents recorded before thresholds were stored.
  thresholdKey: string | null;
  // History keeps the raw 1-minute load; the rule compares it per core.
  perCore?: boolean;
}

// Alert keys with a matching series in /api/history/window.
const CONTEXT: Record<string, ContextDef> = {
  cpu: { metric: 'cpu', label: 'CPU usage', unit: '%', thresholdKey: 'ALERT_CPU_ENTER' },
  memory: { metric: 'mem', label: 'Memory usage', unit: '%', thresholdKey: 'ALERT_MEM_ENTER' },
  disk: { metric: 'disk', label: 'Disk usage', unit: '%', thresholdKey: 'ALERT_DISK_ENTER' },
  temperature: { metric: 'temp', label: 'CPU temperature', unit: '°C', thresholdKey: 'ALERT_TEMP_ENTER' },
  swap: { metric: 'swap', label: 'Swap usage', unit: '%', thresholdKey: 'ALERT_SWAP_ENTER' },
  loadPerCore: {
    metric: 'load',
    label: 'Load per core',
    unit: '',
    thresholdKey: 'ALERT_LOAD_ENTER',
    perCore: true
  },
  cpuAnomaly: { metric: 'cpu', label: 'CPU usage', unit: '%', thresholdKey: null },
  memAnomaly: { metric: 'mem', label: 'Memory usage', unit: '%', thresholdKey: null },
  memPressure: { metric: 'mem', label: 'Memory usage', unit: '%', thresholdKey: null }
};

const MARGIN_MS = 30 * 60_000;
// /api/history/window answers spans up to 31 days; keep the newest 30.
const MAX_SPAN_MS = 30 * 24 * 3_600_000;

export interface ContextSpec extends ContextDef {
  from: number;
  to: number;
}

// The series and window (30 minutes either side of the incident) that show
// this incident, or null when the rule has no numeric series. An ongoing
// incident's window ends at the current minute, so the URL changes once a
// minute rather than every render.
export function contextSpec(incident: Incident, now: number): ContextSpec | null {
  const context = CONTEXT[incident.key];
  if (!context) return null;
  const opened = new Date(incident.openedAt).getTime();
  const to = incident.resolvedAt
    ? Math.min(now, new Date(incident.resolvedAt).getTime() + MARGIN_MS)
    : Math.ceil(now / 60_000) * 60_000;
  const from = Math.max(opened - MARGIN_MS, to - MAX_SPAN_MS);
  return { ...context, from, to };
}

export function windowUrl(spec: ContextSpec): string {
  return `/api/history/window?metric=${spec.metric}&from=${spec.from}&to=${spec.to}`;
}

export interface ContextChart {
  values: (number | null)[];
  // Fractions (0–1) of the window the incident covers.
  spanStart: number;
  spanEnd: number;
}

export function contextChart(
  window: MetricWindow,
  incident: Incident,
  now: number,
  divisor = 1
): ContextChart | null {
  const { points } = window;
  if (points.length < 2) return null;
  const first = new Date(points[0].at).getTime();
  const last = new Date(points[points.length - 1].at).getTime();
  const span = Math.max(1, last - first);
  const fraction = (at: number) => Math.min(1, Math.max(0, (at - first) / span));
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now;
  const scale = divisor > 0 ? divisor : 1;
  return {
    values: points.map(point =>
      point.value === null ? null : Math.round((point.value / scale) * 100) / 100
    ),
    spanStart: fraction(new Date(incident.openedAt).getTime()),
    spanEnd: fraction(end)
  };
}

// "90%", "74°C", "2" — a stored threshold as the rule writes it.
export function formatThreshold(threshold: AlertThreshold | null | undefined): string {
  return threshold ? `${threshold.value}${threshold.unit}` : '—';
}

// Who an event came from. Older incidents have no author: infer it from the kind.
export function eventAuthor(event: IncidentEvent): 'operator' | 'system' {
  if (event.author) return event.author;
  return event.kind === 'note' || event.kind === 'ack' || event.kind === 'reopen' ? 'operator' : 'system';
}
