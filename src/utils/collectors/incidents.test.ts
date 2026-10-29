import { describe, expect, it } from 'vitest';

import { applyAction, type Incident } from '@/utils/collectors/incidents';

const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);

const base: Incident = {
  id: 'i1',
  key: 'cpu',
  title: 'CPU usage 95%',
  level: 'warning',
  rule: 'ALERT_CPU_ENTER',
  status: 'open',
  openedAt: new Date(T0).toISOString(),
  resolvedAt: null,
  events: []
};

describe('applyAction', () => {
  it('walks open → acknowledged → resolved → open', () => {
    const acked = applyAction(base, 'ack', T0 + 1000) as Incident;
    expect(acked.status).toBe('acknowledged');
    const resolved = applyAction(acked, 'resolve', T0 + 2000) as Incident;
    expect(resolved).toMatchObject({ status: 'resolved', resolvedAt: new Date(T0 + 2000).toISOString() });
    const reopened = applyAction(resolved, 'reopen', T0 + 3000) as Incident;
    expect(reopened).toMatchObject({ status: 'open', resolvedAt: null });
    expect(reopened.events.map(event => event.kind)).toEqual(['ack', 'resolve', 'reopen']);
  });

  it('rejects invalid transitions and empty notes', () => {
    expect(applyAction(base, 'reopen', T0)).toBe('Only a resolved incident can be reopened');
    expect(applyAction({ ...base, status: 'acknowledged' }, 'ack', T0)).toBe(
      'Only an open incident can be acknowledged'
    );
    expect(applyAction(base, 'note', T0, '   ')).toBe('Write a note first');
    expect(applyAction(base, 'note', T0, 'x'.repeat(501))).toMatch(/limited/);
  });

  it('appends trimmed notes without changing status', () => {
    const noted = applyAction(base, 'note', T0, '  restarted the worker ') as Incident;
    expect(noted.status).toBe('open');
    expect(noted.events.at(-1)).toMatchObject({ kind: 'note', text: 'restarted the worker' });
  });
});
