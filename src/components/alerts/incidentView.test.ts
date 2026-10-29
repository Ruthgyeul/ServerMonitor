import { describe, expect, it } from 'vitest';

import { contextChart, contextSpec, formatSpan, openIncidentByKey } from '@/components/alerts/incidentView';
import type { MetricPoint } from '@/types/system';
import type { Incident } from '@/utils/collectors/incidents';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function incident(extra: Partial<Incident> = {}): Incident {
  return {
    id: 'i',
    key: 'cpu',
    title: 'CPU usage 95%',
    level: 'warning',
    rule: 'ALERT_CPU_ENTER',
    status: 'open',
    openedAt: iso(30),
    resolvedAt: null,
    events: [],
    ...extra
  };
}

describe('formatSpan', () => {
  it.each([
    [45_000, '45s'],
    [12 * 60_000, '12m'],
    [185 * 60_000, '3h 5m'],
    [52 * 3_600_000, '2d 4h']
  ])('%d ms → %s', (ms, label) => expect(formatSpan(ms)).toBe(label));
});

describe('openIncidentByKey', () => {
  it('keeps the newest unresolved incident per key', () => {
    const map = openIncidentByKey([
      incident({ id: 'new' }),
      incident({ id: 'old' }),
      incident({ id: 'done', key: 'disk', status: 'resolved' })
    ]);
    expect(map.get('cpu')?.id).toBe('new');
    expect(map.has('disk')).toBe(false);
  });
});

describe('contextSpec', () => {
  it('picks the shortest range that leaves lead-in before the incident', () => {
    expect(contextSpec(incident(), NOW)).toMatchObject({ metric: 'cpu', range: '6h' });
    expect(contextSpec(incident({ openedAt: iso(10 * 60) }), NOW)?.range).toBe('24h');
    expect(contextSpec(incident({ openedAt: iso(8 * 24 * 60) }), NOW)).toBeNull();
  });

  it('has no chart for rules without a series', () => {
    expect(contextSpec(incident({ key: 'http:a' }), NOW)).toBeNull();
  });
});

describe('contextChart', () => {
  it('places the incident span inside the window', () => {
    const points: MetricPoint[] = [0, 1, 2, 3, 4].map(index => ({
      at: iso(60 - index * 15),
      cpu: index * 10,
      mem: null,
      disk: null,
      down: null,
      up: null
    }));
    const chart = contextChart(points, 'cpu', incident({ openedAt: iso(45), resolvedAt: iso(15) }), NOW)!;
    expect(chart.values).toEqual([0, 10, 20, 30, 40]);
    expect(chart.spanStart).toBeCloseTo(0.25);
    expect(chart.spanEnd).toBeCloseTo(0.75);
  });
});
