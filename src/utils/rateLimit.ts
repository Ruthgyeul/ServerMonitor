// Per-IP token-bucket rate limiting for the public JSON endpoints
// (/api/system, /api/metrics). CORS and the optional token gate don't stop a
// script hammering the endpoint from an allowed origin or an open deployment;
// this caps the request rate so collection (which shells out to ps/df/sensors)
// can't be driven into a busy loop.
//
// In-memory and per-process — good enough for a single self-hosted instance;
// front it with a reverse proxy limiter if you run several replicas.
//
// Tuned by RATE_LIMIT_RPM (requests per minute per IP). 0 disables it entirely.
// The default is generous so server-to-server cluster polling (~60/min per node)
// and several dashboards are unaffected.

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  take(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number };
}

// Pure, injectable core so the refill maths can be unit-tested without timers.
export function createRateLimiter(rpm: number, burst?: number): RateLimiter {
  const capacity = Math.max(1, burst ?? Math.min(rpm, 100));
  const refillPerSecond = rpm / 60;
  const buckets = new Map<string, Bucket>();

  // Drop buckets untouched for a while so a stream of unique IPs can't grow the
  // map without bound. Cheap: only sweeps once the map gets sizeable.
  const IDLE_MS = 10 * 60 * 1000;
  function prune(now: number): void {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > IDLE_MS) buckets.delete(key);
    }
  }

  return {
    take(key: string, now: number = Date.now()) {
      const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };

      // Refill proportionally to elapsed time, capped at capacity.
      const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
      bucket.updatedAt = now;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        buckets.set(key, bucket);
        prune(now);
        return { allowed: true, retryAfterSeconds: 0 };
      }

      buckets.set(key, bucket);
      // Seconds until one token is available again.
      const retryAfterSeconds = refillPerSecond > 0 ? Math.ceil((1 - bucket.tokens) / refillPerSecond) : 60;
      return { allowed: false, retryAfterSeconds };
    }
  };
}

// The first hop of X-Forwarded-For (set by a reverse proxy), else the platform
// real-ip header, else a shared bucket. Behind a proxy that doesn't set these,
// all clients share one bucket — acceptable for a coarse safety cap.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

const RPM = Number(process.env.RATE_LIMIT_RPM ?? 300);
// A single shared limiter for the process. Disabled (null) when RPM <= 0.
const limiter: RateLimiter | null = Number.isFinite(RPM) && RPM > 0 ? createRateLimiter(RPM) : null;

// Returns a 429 Response when the caller is over the limit, or null to proceed.
export function enforceRateLimit(request: Request): Response | null {
  if (!limiter) return null;
  const { allowed, retryAfterSeconds } = limiter.take(clientIp(request));
  if (allowed) return null;

  return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSeconds),
      'Cache-Control': 'no-store'
    }
  });
}
