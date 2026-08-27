import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AlertEntry } from '@/types/system';

const ENV_KEYS = [
  'ALERT_WEBHOOK_URL',
  'ALERT_WEBHOOK_URL_CRITICAL',
  'ALERT_WEBHOOK_URL_WARNING',
  'ALERT_WEBHOOK_FORMAT',
  'ALERT_BATCH_MS'
];

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  ENV_KEYS.forEach(key => delete process.env[key]);
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return import('@/utils/collectors/notify');
}

afterEach(() => ENV_KEYS.forEach(key => delete process.env[key]));

const entry = (level: AlertEntry['level']): AlertEntry => ({
  id: '1',
  level,
  message: 'test message',
  at: '2026-01-02T00:00:00.000Z'
});

describe('channelsFor', () => {
  it('routes a level to its override, falling back to the default', async () => {
    const { channelsFor } = await load({
      ALERT_WEBHOOK_URL: 'https://default.test',
      ALERT_WEBHOOK_URL_CRITICAL: 'https://pager.test'
    });
    expect(channelsFor('critical')).toEqual(['https://pager.test']);
    expect(channelsFor('warning')).toEqual(['https://default.test']);
  });

  it('supports multiple comma-separated default targets', async () => {
    const { channelsFor } = await load({ ALERT_WEBHOOK_URL: 'https://a.test, https://b.test' });
    expect(channelsFor('info')).toEqual(['https://a.test', 'https://b.test']);
  });

  it('is empty when nothing is configured', async () => {
    const { channelsFor } = await load();
    expect(channelsFor('warning')).toEqual([]);
  });
});

describe('formatPayload', () => {
  it('emits a single object for one entry and an array for a batch (json)', async () => {
    const { formatPayload } = await load({ ALERT_WEBHOOK_URL: 'https://x.test' });
    expect(JSON.parse(formatPayload([entry('warning')]))).toMatchObject({ message: 'test message' });
    expect(Array.isArray(JSON.parse(formatPayload([entry('warning'), entry('info')])))).toBe(true);
  });

  it('uses the slack shape when configured', async () => {
    const { formatPayload } = await load({
      ALERT_WEBHOOK_URL: 'https://x.test',
      ALERT_WEBHOOK_FORMAT: 'slack'
    });
    const body = JSON.parse(formatPayload([entry('critical')]));
    expect(body.text).toContain('test message');
  });
});
