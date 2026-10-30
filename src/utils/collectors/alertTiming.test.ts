import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AlertInput } from '@/utils/collectors/alerts';

// Fire/resolve delays, suppressed spikes, external conditions and the
// incidents they open. Modules are re-imported per test; shared process state
// is reset by the test setup.
const ENV_KEYS = [
  'DATA_DIR',
  'ALERTS_FILE',
  'INCIDENTS_FILE',
  'ALERT_WEBHOOK_URL',
  'ALERT_FIRE_DELAY_SECONDS',
  'ALERT_RESOLVE_DELAY_SECONDS'
];

async function fresh(env: Record<string, string> = {}) {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'alert-timing-'));
  process.env.DATA_DIR = dir;
  process.env.ALERTS_FILE = join(dir, 'alerts.json');
  process.env.INCIDENTS_FILE = join(dir, 'incidents.json');
  process.env.ALERT_WEBHOOK_URL = 'https://example.test/hook';
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const alerts = await import('@/utils/collectors/alerts');
  const { incidents } = await import('@/utils/collectors/incidents');
  return { ...alerts, incidents, fetchMock };
}

function input(cpu: number): AlertInput {
  return {
    cpu,
    memory: 10,
    disk: 10,
    swap: 0,
    temperature: 40,
    firewall: 'active',
    sshSessions: [],
    interfaces: []
  };
}

const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.unstubAllGlobals();
});

describe('fire delay', () => {
  it('waits for the breach to hold before alerting', async () => {
    const { evaluateAlerts, getActiveAlerts, getPendingAlerts } = await fresh({
      ALERT_FIRE_DELAY_SECONDS: '30'
    });
    evaluateAlerts(input(10), T0); // consume the startup evaluation
    evaluateAlerts(input(95), T0 + 1000);
    expect(getActiveAlerts()).toHaveLength(0);
    expect(getPendingAlerts(T0 + 1000)).toMatchObject([
      { key: 'cpu', state: 'pending', dueAt: new Date(T0 + 31_000).toISOString() }
    ]);

    evaluateAlerts(input(95), T0 + 31_000);
    expect(getActiveAlerts().map(alert => alert.key)).toEqual(['cpu']);
    expect(getPendingAlerts(T0 + 31_000)).toHaveLength(0);
  });

  it('counts a breach that ends early as a suppressed spike', async () => {
    const { evaluateAlerts, getActiveAlerts, getAlertTiming, getAlertLog } = await fresh({
      ALERT_FIRE_DELAY_SECONDS: '30'
    });
    evaluateAlerts(input(10), T0);
    evaluateAlerts(input(95), T0 + 1000);
    evaluateAlerts(input(10), T0 + 6000);
    expect(getActiveAlerts()).toHaveLength(0);
    expect(getAlertTiming(T0 + 6000)).toEqual({ fireDelaySec: 30, resolveDelaySec: 0, suppressedSpikes: 1 });
    expect(getAlertLog()[0].message).toMatch(/^Suppressed short spike: CPU usage 95% for 5s/);
  });
});

describe('resolve delay', () => {
  it('keeps the alert until recovery holds, and cancels on a relapse', async () => {
    const { evaluateAlerts, getActiveAlerts, getPendingAlerts } = await fresh({
      ALERT_RESOLVE_DELAY_SECONDS: '60'
    });
    evaluateAlerts(input(10), T0);
    evaluateAlerts(input(95), T0 + 1000);
    evaluateAlerts(input(10), T0 + 2000);
    expect(getActiveAlerts()).toHaveLength(1);
    expect(getPendingAlerts(T0 + 2000)[0]).toMatchObject({ state: 'recovering' });

    evaluateAlerts(input(95), T0 + 3000); // relapse resets the wait
    evaluateAlerts(input(10), T0 + 4000);
    evaluateAlerts(input(10), T0 + 62_000);
    expect(getActiveAlerts()).toHaveLength(1);
    evaluateAlerts(input(10), T0 + 64_000);
    expect(getActiveAlerts()).toHaveLength(0);
  });
});

describe('incidents', () => {
  it('opens one incident per firing and resolves it on recovery', async () => {
    const { evaluateAlerts, incidents } = await fresh();
    evaluateAlerts(input(10), T0);
    evaluateAlerts(input(95), T0 + 1000);
    evaluateAlerts(input(96), T0 + 2000);
    const [incident] = incidents().list();
    expect(incidents().list()).toHaveLength(1);
    expect(incident).toMatchObject({ key: 'cpu', status: 'open', rule: 'ALERT_CPU_ENTER' });
    expect(incident.events.map(event => event.kind)).toEqual(['trigger', 'notify']);
    expect(incident.events[1].text).toBe('Notified webhook');

    evaluateAlerts(input(10), T0 + 3000);
    expect(incidents().list()[0]).toMatchObject({ status: 'resolved' });
  });
});

describe('evaluateExternal', () => {
  const down = {
    key: 'http:a',
    level: 'critical' as const,
    message: 'HTTP check failed: API (503)',
    recoveredMessage: 'HTTP check recovered: API',
    rule: 'uptime check'
  };

  it('records conditions failing at startup without paging, then pages on new failures', async () => {
    const { evaluateExternal, getActiveAlerts, fetchMock, getAlertLog } = await fresh();
    evaluateExternal([down], T0);
    expect(getActiveAlerts().map(alert => alert.key)).toEqual(['http:a']);
    expect(fetchMock).not.toHaveBeenCalled();

    evaluateExternal([], T0 + 1000);
    expect(getActiveAlerts()).toHaveLength(0);
    expect(getAlertLog()[0]).toMatchObject({ level: 'ok', message: 'HTTP check recovered: API' });

    evaluateExternal([down], T0 + 2000);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('alert descriptions', () => {
  it('gives threshold alerts a short form, rule text and the threshold', async () => {
    const { evaluateAlerts, getActiveAlerts, getPendingAlerts, incidents } = await fresh({
      ALERT_FIRE_DELAY_SECONDS: '0'
    });
    evaluateAlerts(input(10), T0);
    evaluateAlerts(input(95), T0 + 1000);
    expect(getActiveAlerts()[0]).toMatchObject({
      short: 'CPU 95% > 90%',
      ruleText: 'cpu > 90%',
      threshold: { value: 90, unit: '%' }
    });
    expect(incidents().list()[0]).toMatchObject({ threshold: { value: 90, unit: '%' } });
    expect(incidents().list()[0].events.every(event => event.author === 'system')).toBe(true);
    expect(getPendingAlerts(T0 + 1000)).toEqual([]);
  });

  it('carries the short form on pending breaches', async () => {
    const { evaluateAlerts, getPendingAlerts } = await fresh({ ALERT_FIRE_DELAY_SECONDS: '30' });
    evaluateAlerts(input(10), T0);
    evaluateAlerts(input(93.5), T0 + 1000);
    expect(getPendingAlerts(T0 + 1000)[0].short).toBe('CPU 93.5% > 90%');
  });
});
