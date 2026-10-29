import { describe, expect, it } from 'vitest';

import { isCrossSiteRequest } from '@/utils/sameOrigin';

function request(headers: Record<string, string>): Request {
  return new Request('http://monitor.local/api/uptime', { method: 'POST', headers });
}

describe('isCrossSiteRequest', () => {
  it('allows requests without browser origin headers (curl, scripts)', () => {
    expect(isCrossSiteRequest(request({ host: 'monitor.local' }))).toBe(false);
  });

  it('allows a same-origin browser request', () => {
    expect(
      isCrossSiteRequest(
        request({ host: 'monitor.local', origin: 'http://monitor.local', 'sec-fetch-site': 'same-origin' })
      )
    ).toBe(false);
  });

  it('refuses when Sec-Fetch-Site says cross-site or same-site', () => {
    expect(isCrossSiteRequest(request({ host: 'monitor.local', 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(isCrossSiteRequest(request({ host: 'monitor.local', 'sec-fetch-site': 'same-site' }))).toBe(true);
  });

  it('refuses when Origin names another host', () => {
    expect(isCrossSiteRequest(request({ host: 'monitor.local', origin: 'https://evil.example' }))).toBe(true);
  });

  it('compares against the forwarded host behind a proxy', () => {
    expect(
      isCrossSiteRequest(
        request({
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'monitor.local',
          origin: 'https://monitor.local'
        })
      )
    ).toBe(false);
  });
});
