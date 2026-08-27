import { describe, expect, it } from 'vitest';

import { validateConfig } from '@/utils/validateConfig';

describe('validateConfig', () => {
  it('returns no warnings for an empty (all-default) environment', () => {
    expect(validateConfig({})).toEqual([]);
  });

  it('returns no warnings for a well-formed environment', () => {
    const warnings = validateConfig({
      NEXT_PUBLIC_CLUSTER_SERVERS: '[{"name":"a","ip":"10.0.0.1","type":"rpi"}]',
      PING_HOST: '8.8.8.8',
      ALERT_CPU_ENTER: '90',
      ALERT_CPU_CLEAR: '80',
      ALERT_WEBHOOK_URL: 'https://hooks.example.com/x',
      ALERT_WEBHOOK_FORMAT: 'slack',
      SSH_PORTS: '22,2222',
      API_AUTH_TOKEN: '0123456789abcdef0123'
    });
    expect(warnings).toEqual([]);
  });

  it('flags invalid cluster JSON', () => {
    expect(validateConfig({ NEXT_PUBLIC_CLUSTER_SERVERS: 'not json' })[0]).toContain('not valid JSON');
  });

  it('flags malformed cluster entries', () => {
    const warnings = validateConfig({
      NEXT_PUBLIC_CLUSTER_SERVERS: '[{"name":"a","ip":"1.1.1.1","type":"bad"}]'
    });
    expect(warnings[0]).toContain('malformed');
  });

  it('flags an invalid PING_HOST', () => {
    expect(validateConfig({ PING_HOST: 'bad host!' }).some(w => w.includes('PING_HOST'))).toBe(true);
  });

  it('flags inverted alert hysteresis (enter <= clear)', () => {
    const warnings = validateConfig({ ALERT_CPU_ENTER: '70', ALERT_CPU_CLEAR: '80' });
    expect(warnings.some(w => w.includes('not above clear'))).toBe(true);
  });

  it('flags a non-numeric threshold', () => {
    expect(validateConfig({ ALERT_MEM_ENTER: 'high' }).some(w => w.includes('ALERT_MEM_ENTER'))).toBe(true);
  });

  it('flags a one-sided override that inverts against the default clear', () => {
    // ALERT_CPU_CLEAR defaults to 80, so an enter of 70 alone still inverts.
    const warnings = validateConfig({ ALERT_CPU_ENTER: '70' });
    expect(warnings.some(w => w.includes('not above clear (80)'))).toBe(true);
  });

  it('flags a non-positive IDLE_TICK_MS', () => {
    expect(validateConfig({ IDLE_TICK_MS: '-1' }).some(w => w.includes('IDLE_TICK_MS'))).toBe(true);
    expect(validateConfig({ IDLE_TICK_MS: '0' }).some(w => w.includes('IDLE_TICK_MS'))).toBe(true);
    expect(validateConfig({ IDLE_TICK_MS: '15000' }).some(w => w.includes('IDLE_TICK_MS'))).toBe(false);
  });

  it('flags an invalid webhook URL and unknown format', () => {
    const warnings = validateConfig({ ALERT_WEBHOOK_URL: 'not-a-url', ALERT_WEBHOOK_FORMAT: 'xml' });
    expect(warnings.some(w => w.includes('ALERT_WEBHOOK_URL'))).toBe(true);
    expect(warnings.some(w => w.includes('ALERT_WEBHOOK_FORMAT'))).toBe(true);
  });

  it('flags invalid SSH ports and a short token', () => {
    const warnings = validateConfig({ SSH_PORTS: '22,notaport,70000', API_AUTH_TOKEN: 'short' });
    expect(warnings.some(w => w.includes('SSH_PORTS'))).toBe(true);
    expect(warnings.some(w => w.includes('API_AUTH_TOKEN'))).toBe(true);
  });
});
