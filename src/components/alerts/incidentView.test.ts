import { describe, expect, it } from 'vitest';

import {
  contextChart,
  contextSpec,
  eventAuthor,
  formatSpan,
  formatThreshold,
  incidentByKey,
  windowUrl
} from '@/components/alerts/incidentView';
import type { MetricWindow } from '@/types/system';
import type { Incident } from '@/utils/collectors/incidents';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const MINUTE = 60_000;
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE).toISOString();

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

describe('incidentByKey', () => {
  it('prefers the newest unresolved incident per key', () => {
    const map = incidentByKey([
      incident({ id: 'done-newer', status: 'resolved' }),
      incident({ id: 'open' }),
      incident({ id: 'old' })
    ]);
    expect(map.get('cpu')?.id).toBe('open');
  });

  it('falls back to the most recent incident when none is open', () => {
    const map = incidentByKey([
      incident({ id: 'latest', key: 'disk', status: 'resolved' }),
      incident({ id: 'older', key: 'disk', status: 'resolved' })
    ]);
    expect(map.get('disk')?.id).toBe('latest');
    expect(map.has('cpu')).toBe(false);
  });
});

describe('contextSpec', () => {
  it('spans 30 minutes either side of a resolved incident', () => {
    const spec = contextSpec(incident({ openedAt: iso(120), resolvedAt: iso(90) }), NOW)!;
    expect(spec).toMatchObject({ metric: 'cpu', unit: '%', thresholdKey: 'ALERT_CPU_ENTER' });
    expect(spec.from).toBe(NOW - 150 * MINUTE);
    expect(spec.to).toBe(NOW - 60 * MINUTE);
    expect(windowUrl(spec)).toBe(`/api/history/window?metric=cpu&from=${spec.from}&to=${spec.to}`);
  });

  it('ends an ongoing incident at the current minute and never past now', () => {
    expect(contextSpec(incident(), NOW + 15_000)!.to).toBe(NOW + MINUTE);
    expect(contextSpec(incident({ resolvedAt: iso(5) }), NOW)!.to).toBe(NOW);
  });

  it('maps temperature, swap and load rules to their series', () => {
    expect(contextSpec(incident({ key: 'temperature' }), NOW)).toMatchObject({ metric: 'temp', unit: '°C' });
    expect(contextSpec(incident({ key: 'swap' }), NOW)).toMatchObject({ metric: 'swap' });
    expect(contextSpec(incident({ key: 'loadPerCore' }), NOW)).toMatchObject({
      metric: 'load',
      perCore: true
    });
  });

  it('keeps the window within what the history API answers', () => {
    const spec = contextSpec(incident({ openedAt: iso(60 * 24 * 45) }), NOW)!;
    expect(spec.to - spec.from).toBeLessThanOrEqual(30 * 24 * 60 * MINUTE + MINUTE);
  });

  it('has no chart for rules without a series', () => {
    expect(contextSpec(incident({ key: 'http:a' }), NOW)).toBeNull();
  });
});

describe('contextChart', () => {
  const window: MetricWindow = {
    metric: 'load',
    stepSeconds: 900,
    points: [0, 1, 2, 3, 4].map(index => ({ at: iso(60 - index * 15), value: index * 2 }))
  };

  it('places the incident span inside the window', () => {
    const chart = contextChart(window, incident({ openedAt: iso(45), resolvedAt: iso(15) }), NOW)!;
    expect(chart.values).toEqual([0, 2, 4, 6, 8]);
    expect(chart.spanStart).toBeCloseTo(0.25);
    expect(chart.spanEnd).toBeCloseTo(0.75);
  });

  it('divides by the core count for per-core rules and keeps gaps', () => {
    const gappy: MetricWindow = {
      ...window,
      points: [...window.points.slice(0, 4), { at: iso(0), value: null }]
    };
    expect(contextChart(gappy, incident(), NOW, 4)!.values).toEqual([0, 0.5, 1, 1.5, null]);
  });

  it('needs two points', () => {
    expect(contextChart({ ...window, points: window.points.slice(0, 1) }, incident(), NOW)).toBeNull();
  });
});

describe('formatThreshold / eventAuthor', () => {
  it('writes a stored threshold with its unit', () => {
    expect(formatThreshold({ value: 90, unit: '%' })).toBe('90%');
    expect(formatThreshold({ value: 2, unit: '' })).toBe('2');
    expect(formatThreshold(null)).toBe('—');
  });

  it('uses the stored author, inferring it for older events', () => {
    expect(eventAuthor({ at: iso(0), kind: 'resolve', text: 'x', author: 'operator' })).toBe('operator');
    expect(eventAuthor({ at: iso(0), kind: 'note', text: 'x' })).toBe('operator');
    expect(eventAuthor({ at: iso(0), kind: 'trigger', text: 'x' })).toBe('system');
  });
});
