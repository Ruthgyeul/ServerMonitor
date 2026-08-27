import { describe, expect, it } from 'vitest';

import { clientIp, createRateLimiter, enforceLoginRateLimit } from '@/utils/rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the burst capacity, then blocks', () => {
    const limiter = createRateLimiter(60, 5); // 1 token/sec, burst 5
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.take('ip', now).allowed).toBe(true);
    }
    const blocked = limiter.take('ip', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    const limiter = createRateLimiter(60, 2); // 1 token/sec, burst 2
    const start = 1_000_000;
    limiter.take('ip', start);
    limiter.take('ip', start);
    expect(limiter.take('ip', start).allowed).toBe(false);
    // One second later, one token has refilled.
    expect(limiter.take('ip', start + 1000).allowed).toBe(true);
  });

  it('tracks buckets per key', () => {
    const limiter = createRateLimiter(60, 1);
    const now = 1_000_000;
    expect(limiter.take('a', now).allowed).toBe(true);
    expect(limiter.take('a', now).allowed).toBe(false);
    // A different IP has its own full bucket.
    expect(limiter.take('b', now).allowed).toBe(true);
  });
});

describe('enforceLoginRateLimit', () => {
  it('returns a 429 after the login attempt burst is exhausted', () => {
    const request = new Request('http://x', { method: 'POST' });
    let last: Response | null = null;
    // Burst is 5; the sixth attempt within the same tick should be limited.
    for (let i = 0; i < 6; i += 1) last = enforceLoginRateLimit(request);
    expect(last?.status).toBe(429);
    expect(last?.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('clientIp', () => {
  it('uses the first X-Forwarded-For hop when a proxy is trusted', () => {
    const request = new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
    expect(clientIp(request, true)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then a shared key, when a proxy is trusted', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.2' } }), true)).toBe(
      '198.51.100.2'
    );
    expect(clientIp(new Request('http://x'), true)).toBe('all');
  });

  it('ignores spoofable forwarding headers when no proxy is trusted', () => {
    const request = new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(clientIp(request, false)).toBe('all');
  });
});
