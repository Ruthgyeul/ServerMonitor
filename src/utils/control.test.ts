import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeControl,
  clientAddress,
  controlStatus,
  inCidrs,
  ipv4ToInt,
  parseCidr,
  parseControlConfig,
  PEER_HEADER
} from '@/utils/control';

// The action budget (3 per burst) is covered by the rate limiter's own tests;
// here it would only trip the repeated authorisation checks.
vi.mock('@/utils/rateLimit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/rateLimit')>()),
  enforceActionRateLimit: () => null
}));

const ENV_KEYS = ['DASHBOARD_PASSWORD', 'API_AUTH_TOKEN', '__SERVERMONITOR_CUSTOM_SERVER'];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('address parsing', () => {
  it('reads IPv4 and IPv4-mapped IPv6', () => {
    expect(ipv4ToInt('192.168.0.5')).toBe(0xc0a80005);
    expect(ipv4ToInt('::ffff:192.168.0.5')).toBe(0xc0a80005);
    expect(ipv4ToInt('192.168.0.256')).toBeNull();
    expect(ipv4ToInt('fe80::1')).toBeNull();
  });

  it('matches addresses against CIDRs', () => {
    const cidrs = ['192.168.0.0/24', '10.0.0.7'].map(spec => parseCidr(spec)!);
    expect(inCidrs('192.168.0.200', cidrs)).toBe(true);
    expect(inCidrs('::ffff:192.168.0.9', cidrs)).toBe(true);
    expect(inCidrs('192.168.1.2', cidrs)).toBe(false);
    expect(inCidrs('10.0.0.7', cidrs)).toBe(true);
    expect(inCidrs('10.0.0.8', cidrs)).toBe(false);
    expect(parseCidr('1.2.3.4/33')).toBeNull();
  });
});

describe('parseControlConfig', () => {
  it('is off by default with the LAN /24 allowed', () => {
    const config = parseControlConfig({});
    expect(config.enabled).toBe(false);
    expect(config.prune).toBe(false);
    expect(inCidrs('192.168.0.10', config.cidrs)).toBe(true);
    expect(config.containers.names.size).toBe(0);
  });

  it('reads allowlists, including the * wildcard', () => {
    const config = parseControlConfig({
      CONTROL_ENABLED: 'true',
      CONTROL_ALLOWLIST_CONTAINERS: 'nginx, postgres',
      CONTROL_ALLOWLIST_UNITS: '*'
    });
    expect([...config.containers.names]).toEqual(['nginx', 'postgres']);
    expect(config.units.all).toBe(true);
  });
});

describe('clientAddress', () => {
  const config = parseControlConfig({});
  const request = (headers: Record<string, string>) => new Request('http://monitor.local/', { headers });

  it('trusts only the address stamped by the bundled server', () => {
    expect(clientAddress(request({ [PEER_HEADER]: '192.168.0.5' }), config)).toBeNull();
    process.env.__SERVERMONITOR_CUSTOM_SERVER = '1';
    expect(clientAddress(request({ [PEER_HEADER]: '192.168.0.5' }), config)).toBe('192.168.0.5');
  });

  it('uses X-Forwarded-For only behind a loopback proxy with CONTROL_TRUST_PROXY', () => {
    process.env.__SERVERMONITOR_CUSTOM_SERVER = '1';
    const proxied = request({ [PEER_HEADER]: '127.0.0.1', 'x-forwarded-for': '192.168.0.9' });
    expect(clientAddress(proxied, config)).toBe('127.0.0.1');
    expect(clientAddress(proxied, parseControlConfig({ CONTROL_TRUST_PROXY: 'true' }))).toBe('192.168.0.9');
    const direct = request({ [PEER_HEADER]: '192.168.0.5', 'x-forwarded-for': '192.168.0.9' });
    expect(clientAddress(direct, parseControlConfig({ CONTROL_TRUST_PROXY: 'true' }))).toBe('192.168.0.5');
  });
});

describe('authorizeControl', () => {
  const enabled = parseControlConfig({
    CONTROL_ENABLED: 'true',
    CONTROL_ALLOWLIST_CONTAINERS: 'nginx',
    CONTROL_ALLOWLIST_UNITS: 'nginx.service'
  });
  const request = (peer: string) =>
    new Request('http://monitor.local/api/control/docker/nginx', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', [PEER_HEADER]: peer }
    });
  const errorOf = async (response: Response | null) =>
    response ? ((await response.json()) as { error: string }).error : null;

  it('refuses everything while the gate is off or login is off', async () => {
    process.env.API_AUTH_TOKEN = 'secret';
    process.env.__SERVERMONITOR_CUSTOM_SERVER = '1';
    expect(
      await errorOf(authorizeControl(request('192.168.0.5'), { kind: 'prune' }, parseControlConfig({})))
    ).toMatch(/CONTROL_ENABLED/);
    delete process.env.API_AUTH_TOKEN;
    expect(
      await errorOf(authorizeControl(request('192.168.0.5'), { kind: 'container', name: 'nginx' }, enabled))
    ).toMatch(/login/);
  });

  it('checks the address and the allowlists', async () => {
    process.env.API_AUTH_TOKEN = 'secret';
    process.env.__SERVERMONITOR_CUSTOM_SERVER = '1';
    expect(
      authorizeControl(request('192.168.0.5'), { kind: 'container', name: 'nginx' }, enabled)
    ).toBeNull();
    expect(
      authorizeControl(request('192.168.0.5'), { kind: 'unit', name: 'nginx.service' }, enabled)
    ).toBeNull();
    expect(
      await errorOf(authorizeControl(request('10.1.1.1'), { kind: 'container', name: 'nginx' }, enabled))
    ).toMatch(/address/);
    expect(
      await errorOf(
        authorizeControl(request('192.168.0.5'), { kind: 'container', name: 'postgres' }, enabled)
      )
    ).toMatch(/CONTROL_ALLOWLIST_CONTAINERS/);
    expect(await errorOf(authorizeControl(request('192.168.0.5'), { kind: 'prune' }, enabled))).toMatch(
      /CONTROL_ALLOW_PRUNE/
    );
  });

  it('requires credentials before anything else', async () => {
    process.env.API_AUTH_TOKEN = 'secret';
    const anonymous = new Request('http://monitor.local/', { method: 'POST' });
    expect(authorizeControl(anonymous, { kind: 'prune' }, enabled)?.status).toBe(401);
  });
});

describe('controlStatus', () => {
  it('explains why controls are unavailable', () => {
    expect(controlStatus(parseControlConfig({}))).toMatchObject({
      enabled: false,
      reason: /CONTROL_ENABLED/
    });
    process.env.DASHBOARD_PASSWORD = 'pw';
    expect(
      controlStatus(parseControlConfig({ CONTROL_ENABLED: '1', CONTROL_ALLOWLIST_CONTAINERS: '*' }))
    ).toMatchObject({ enabled: true, reason: null, containers: '*', units: [] });
  });
});
