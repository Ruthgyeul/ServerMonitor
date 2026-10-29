import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultName, isDue, probe, validateCheck } from '@/utils/collectors/uptime';
import type { UptimeCheck } from '@/types/system';

describe('validateCheck', () => {
  it('accepts http(s) URLs with a listed interval', () => {
    expect(validateCheck({ name: 'API', url: 'https://api.example.com/health', intervalSec: 30 })).toBeNull();
    expect(
      validateCheck({ name: '', url: 'http://192.168.0.200:4000/api/health', intervalSec: 10 })
    ).toBeNull();
  });

  it('rejects other schemes, credentials, bad intervals and long names', () => {
    expect(validateCheck({ url: 'not a url', intervalSec: 30 })).toMatch(/full URL/);
    expect(validateCheck({ url: 'file:///etc/passwd', intervalSec: 30 })).toMatch(/http and https/);
    expect(validateCheck({ url: 'https://u:p@example.com', intervalSec: 30 })).toMatch(/Credentials/);
    expect(validateCheck({ url: 'https://example.com', intervalSec: 7 })).toMatch(/interval/);
    expect(validateCheck({ name: 'x'.repeat(61), url: 'https://example.com', intervalSec: 30 })).toMatch(
      /Name/
    );
  });
});

describe('defaultName', () => {
  it('uses the host', () => {
    expect(defaultName('https://status.example.com/health')).toBe('status.example.com');
  });
});

describe('isDue', () => {
  const check = (paused: boolean, lastAt: number | null): UptimeCheck => ({
    id: 'a',
    name: 'a',
    url: 'https://a',
    intervalSec: 30,
    paused,
    history: lastAt === null ? [] : [{ at: new Date(lastAt).toISOString(), ok: true, ms: 5, code: 200 }]
  });

  it('runs never-checked checks and respects the interval and pause', () => {
    const now = 1_000_000;
    expect(isDue(check(false, null), now)).toBe(true);
    expect(isDue(check(false, now - 10_000), now)).toBe(false);
    expect(isDue(check(false, now - 30_000), now)).toBe(true);
    expect(isDue(check(true, null), now)).toBe(false);
  });
});

describe('probe', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('records status and success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 }))
    );
    const sample = await probe('https://example.com', 0);
    expect(sample).toMatchObject({ ok: true, code: 200 });
    expect(sample.ms).not.toBeNull();
  });

  it('marks 5xx and network errors as down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    expect(await probe('https://example.com', 0)).toMatchObject({ ok: false, code: 503 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('timeout');
      })
    );
    expect(await probe('https://example.com', 0)).toEqual({
      at: new Date(0).toISOString(),
      ok: false,
      ms: null,
      code: null
    });
  });
});
