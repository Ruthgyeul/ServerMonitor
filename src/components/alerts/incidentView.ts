import { PALETTE } from '@/lib/theme';
import type { HistoryRange, MetricPoint } from '@/types/system';
import type { Incident, IncidentStatus } from '@/utils/collectors/incidents';

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

// The unresolved incident for each alert key, for "Incident →" links.
export function openIncidentByKey(incidents: Incident[]): Map<string, Incident> {
  const byKey = new Map<string, Incident>();
  for (const incident of incidents) {
    if (incident.status !== 'resolved' && !byKey.has(incident.key)) byKey.set(incident.key, incident);
  }
  return byKey;
}

// --- Metric context ------------------------------------------------------

type ChartMetric = 'cpu' | 'mem' | 'disk';

// Alert keys with a matching chart series, and the threshold that fired them.
const CONTEXT: Record<string, { metric: ChartMetric; label: string; threshold: string }> = {
  cpu: { metric: 'cpu', label: 'CPU usage', threshold: 'ALERT_CPU_ENTER' },
  memory: { metric: 'mem', label: 'Memory usage', threshold: 'ALERT_MEM_ENTER' },
  disk: { metric: 'disk', label: 'Disk usage', threshold: 'ALERT_DISK_ENTER' }
};

const RANGE_SPANS: [HistoryRange, number][] = [
  ['6h', 6 * 3_600_000],
  ['24h', 24 * 3_600_000],
  ['7d', 7 * 24 * 3_600_000]
];

export interface ContextSpec {
  metric: ChartMetric;
  label: string;
  thresholdKey: string;
  range: HistoryRange;
}

// Which series and range show this incident with some lead-in, or null when
// the rule has no numeric series or the incident is older than the charts keep.
export function contextSpec(incident: Incident, now: number): ContextSpec | null {
  const context = CONTEXT[incident.key];
  if (!context) return null;
  const age = now - new Date(incident.openedAt).getTime();
  // Leave a sixth of the window before the incident for context.
  const range = RANGE_SPANS.find(([, span]) => age < (span * 5) / 6)?.[0];
  if (!range) return null;
  return { metric: context.metric, label: context.label, thresholdKey: context.threshold, range };
}

export interface ContextChart {
  values: (number | null)[];
  // Fractions (0–1) of the window the incident covers.
  spanStart: number;
  spanEnd: number;
}

export function contextChart(
  points: MetricPoint[],
  metric: ChartMetric,
  incident: Incident,
  now: number
): ContextChart | null {
  if (points.length < 2) return null;
  const first = new Date(points[0].at).getTime();
  const last = new Date(points[points.length - 1].at).getTime();
  const span = Math.max(1, last - first);
  const fraction = (at: number) => Math.min(1, Math.max(0, (at - first) / span));
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now;
  return {
    values: points.map(point => point[metric]),
    spanStart: fraction(new Date(incident.openedAt).getTime()),
    spanEnd: fraction(end)
  };
}
