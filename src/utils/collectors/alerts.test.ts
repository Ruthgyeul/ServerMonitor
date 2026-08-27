import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AlertInput } from '@/utils/collectors/alerts';

// alerts holds active-rule/log/known state in module scope, so it's reimported
// per test. The store file is also isolated to a temp directory. Webhook calls
// are mocked via fetch to count invocations only (so nothing goes to the real network).
async function freshAlerts(env: Record<string, string> = {}) {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'alerts-test-'));
  process.env.DATA_DIR = dir;
  process.env.ALERTS_FILE = join(dir, 'alerts.json');
  process.env.ALERT_WEBHOOK_URL = 'https://example.test/hook';
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const mod = await import('@/utils/collectors/alerts');
  return { ...mod, fetchMock, dir, file: process.env.ALERTS_FILE };
}

function baseInput(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    cpu: 10,
    memory: 10,
    disk: 10,
    swap: 0,
    temperature: 40,
    firewall: 'active',
    sshSessions: [],
    interfaces: [],
    ...overrides
  };
}

const ENV_KEYS = [
  'DATA_DIR',
  'ALERTS_FILE',
  'ALERT_WEBHOOK_URL',
  'ALERT_WEBHOOK_FORMAT',
  'ALERT_CPU_ENTER',
  'ALERT_CPU_CLEAR',
  'ALERT_RENOTIFY_MINUTES',
  'ALERT_FLAP_THRESHOLD'
];

describe('evaluateAlerts', () => {
  beforeEach(() => ENV_KEYS.forEach(key => delete process.env[key]));
  afterEach(() => {
    vi.unstubAllGlobals();
    ENV_KEYS.forEach(key => delete process.env[key]);
  });

  it('records an alert when a threshold is crossed and clears it on hysteresis', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    // The first evaluation is a normal value — no alerts (so later transitions aren't dumped like a first login).
    expect(evaluateAlerts(baseInput(), t0)).toHaveLength(0);

    // When CPU crosses 90 a warning accumulates.
    const entered = evaluateAlerts(baseInput({ cpu: 95 }), t0 + 1000);
    expect(entered[0].message).toContain('CPU usage 95%');
    expect(entered[0].level).toBe('warning');

    // At 85 (> clearBelow 80) it isn't cleared yet.
    const held = evaluateAlerts(baseInput({ cpu: 85 }), t0 + 2000);
    expect(held.find(e => e.message.includes('back to normal'))).toBeUndefined();

    // Below 80 it logs a clear.
    const cleared = evaluateAlerts(baseInput({ cpu: 70 }), t0 + 3000);
    expect(cleared[0].message).toContain('CPU usage back to normal');
    expect(cleared[0].level).toBe('ok');
  });

  it('on the first evaluation, an already-breached value is logged but not webhooked', async () => {
    const { evaluateAlerts, fetchMock } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    const first = evaluateAlerts(baseInput({ cpu: 99 }), t0);
    expect(first[0].message).toContain('CPU usage 99%');
    // A value already breached right after boot is not pushed out.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifies via webhook when a transition occurs', async () => {
    const { evaluateAlerts, fetchMock } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput(), t0); // consume the first evaluation
    evaluateAlerts(baseInput({ cpu: 95 }), t0 + 1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/hook');
    expect(JSON.parse(options.body as string).message).toContain('CPU usage 95%');
  });

  it('notifies on a new SSH session but not on an already-present one', async () => {
    const { evaluateAlerts, fetchMock } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    const existing = { user: 'root', ip: '10.0.0.1', since: new Date(t0).toISOString() };
    // First evaluation: quietly remember the already-attached session.
    evaluateAlerts(baseInput({ sshSessions: [existing] }), t0);
    expect(fetchMock).not.toHaveBeenCalled();

    // A new session appears -> info alert + notify.
    const newSession = { user: 'deploy', ip: '10.0.0.2', since: new Date(t0 + 1000).toISOString() };
    const log = evaluateAlerts(baseInput({ sshSessions: [existing, newSession] }), t0 + 1000);
    expect(log[0].message).toBe('SSH login: deploy@10.0.0.2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records interface down/recovery transitions', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput({ interfaces: [{ name: 'eth0', state: 'up' }] }), t0);

    const down = evaluateAlerts(baseInput({ interfaces: [{ name: 'eth0', state: 'down' }] }), t0 + 1000);
    expect(down[0].message).toBe('Interface eth0 down');

    const up = evaluateAlerts(baseInput({ interfaces: [{ name: 'eth0', state: 'up' }] }), t0 + 2000);
    expect(up[0].message).toBe('Interface eth0 back up');
  });

  it('lets thresholds be overridden by environment variables', async () => {
    const { evaluateAlerts } = await freshAlerts({ ALERT_CPU_ENTER: '50', ALERT_CPU_CLEAR: '40' });
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput(), t0);
    // With defaults 60 isn't a breach, but with ENTER=50 an alert fires.
    const entered = evaluateAlerts(baseInput({ cpu: 60 }), t0 + 1000);
    expect(entered[0].message).toContain('CPU usage 60%');
  });

  it('persists the alert log to disk and recovers after a restart', async () => {
    const first = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    first.evaluateAlerts(baseInput(), t0);
    first.evaluateAlerts(baseInput({ cpu: 95 }), t0 + 1000);

    // Trigger the same synchronous save as the shutdown path instead of waiting for the scheduled save.
    process.emit('SIGTERM');

    vi.resetModules();
    process.env.DATA_DIR = first.dir;
    process.env.ALERTS_FILE = first.file;
    const second = await import('@/utils/collectors/alerts');
    // The recovered log must contain the earlier CPU alert. It persists even after one normal-value evaluation.
    const log = second.evaluateAlerts(baseInput(), t0 + 2000);
    expect(log.some(e => e.message.includes('CPU usage 95%'))).toBe(true);
  });

  it('alerts on a low battery (below-direction rule) and clears on recovery', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput({ battery: 50 }), t0);
    const entered = evaluateAlerts(baseInput({ battery: 10 }), t0 + 1000);
    expect(entered[0].message).toContain('Battery low 10%');

    const cleared = evaluateAlerts(baseInput({ battery: 30 }), t0 + 2000);
    expect(cleared[0].message).toContain('Battery recovered');
  });

  it('alerts when the disk is forecast to fill soon (below-direction rule)', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput({ diskHoursToFull: 100 }), t0);
    const entered = evaluateAlerts(baseInput({ diskHoursToFull: 10 }), t0 + 1000);
    expect(entered[0].message).toContain('Disk fills in ~10h');
  });

  it('alerts on high load per core', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput({ cores: 4, loadAvg1: 1 }), t0);
    const entered = evaluateAlerts(baseInput({ cores: 4, loadAvg1: 10 }), t0 + 1000);
    expect(entered[0].message).toContain('Load 2.50 per core');
  });

  it('alerts critically on high GPU temperature', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput({ gpuTemp: 50 }), t0);
    const entered = evaluateAlerts(baseInput({ gpuTemp: 90 }), t0 + 1000);
    expect(entered[0].message).toContain('GPU temp 90.0°C');
    expect(entered[0].level).toBe('critical');
  });

  it('clears a disk-fill alert when the forecast becomes null (no longer filling)', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput({ diskHoursToFull: 100 }), t0);
    evaluateAlerts(baseInput({ diskHoursToFull: 10 }), t0 + 1000); // enter
    const cleared = evaluateAlerts(baseInput({ diskHoursToFull: null }), t0 + 2000);
    expect(cleared.some(e => e.message.includes('Disk fill rate eased'))).toBe(true);
  });

  it('keeps alert history beyond the 30-entry SSE view', async () => {
    const { evaluateAlerts, getAlertLog } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput(), t0); // init known-session state
    const sessions: { user: string; ip: string; since: string }[] = [];
    for (let i = 0; i < 40; i += 1) {
      sessions.push({ user: `u${i}`, ip: `10.0.0.${i}`, since: new Date(t0 + i * 1000).toISOString() });
      const view = evaluateAlerts(baseInput({ sshSessions: [...sessions] }), t0 + (i + 1) * 1000);
      expect(view.length).toBeLessThanOrEqual(30); // SSE view stays capped
    }
    expect(getAlertLog().length).toBeGreaterThan(30); // full history is deeper
  });

  it('marks a rule as flapping after repeated transitions', async () => {
    const { evaluateAlerts } = await freshAlerts({ ALERT_FLAP_THRESHOLD: '4' });
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput(), t0);
    evaluateAlerts(baseInput({ cpu: 95 }), t0 + 1000); // enter (1)
    evaluateAlerts(baseInput({ cpu: 70 }), t0 + 2000); // clear (2)
    evaluateAlerts(baseInput({ cpu: 95 }), t0 + 3000); // enter (3)
    const log = evaluateAlerts(baseInput({ cpu: 70 }), t0 + 4000); // clear (4) -> flap
    expect(log.some(e => e.message.includes('flapping'))).toBe(true);
  });
});
