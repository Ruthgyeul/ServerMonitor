// Per-IP token-bucket rate limiting for the public JSON endpoints
// (/api/system, /api/metrics) and for dashboard login attempts. CORS and the
// optional token gate don't stop a script hammering the endpoint from an allowed
// origin or an open deployment; this caps the request rate so collection (which
// shells out to ps/df/sensors) can't be driven into a busy loop, and it slows
// password guessing at /api/auth/login.
//
// In-memory and per-process — good enough for a single self-hosted instance;
// front it with a reverse proxy limiter if you run several replicas.
//
// Tuned by RATE_LIMIT_RPM (requests per minute per IP). 0 disables it entirely;
// a malformed value falls back to the default rather than silently failing open.

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

  // Drop buckets untouched for a while so a stream of unique keys can't grow the
  // map without bound. Throttled to at most once a minute so the O(n) sweep
  // can't run on every request and become its own CPU sink.
  const IDLE_MS = 10 * 60 * 1000;
  let lastPruneAt = 0;
  function maybePrune(now: number): void {
    if (buckets.size < 10_000 || now - lastPruneAt < 60_000) return;
    lastPruneAt = now;
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
        maybePrune(now);
        return { allowed: true, retryAfterSeconds: 0 };
      }

      buckets.set(key, bucket);
      // Seconds until one token is available again.
      const retryAfterSeconds = refillPerSecond > 0 ? Math.ceil((1 - bucket.tokens) / refillPerSecond) : 60;
      return { allowed: false, retryAfterSeconds };
    }
  };
}

// Whether to trust client-supplied forwarding headers. On a directly-exposed
// deployment a caller controls X-Forwarded-For and could mint a fresh bucket per
// request, both bypassing the cap and growing the map — so we trust these
// headers only when RATE_LIMIT_TRUST_PROXY is set (i.e. a reverse proxy that
// overwrites them sits in front). Otherwise every caller shares one bucket, a
// coarse global cap that is still safe.
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.RATE_LIMIT_TRUST_PROXY ?? '');

export function clientIp(request: Request, trustProxy: boolean = TRUST_PROXY): string {
  if (!trustProxy) return 'all';
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'all';
}

// Parse RPM: unset -> default; a real number -> that (0 or less disables);
// anything malformed -> default, so a typo never silently disables the limit.
const RATE_LIMIT_DEFAULT_RPM = 300;
function resolveRpm(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return RATE_LIMIT_DEFAULT_RPM;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : RATE_LIMIT_DEFAULT_RPM;
}

const RPM = resolveRpm(process.env.RATE_LIMIT_RPM);
// A single shared limiter for the public API. Disabled (null) when RPM <= 0.
const apiLimiter: RateLimiter | null = RPM > 0 ? createRateLimiter(RPM) : null;

// A stricter limiter for login attempts, so a dashboard password can't be
// brute-forced. Always on when login is reachable; ~10 attempts/min per key.
const loginLimiter = createRateLimiter(10, 5);

function limitedResponse(retryAfterSeconds: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSeconds),
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

// Returns a 429 Response when the caller is over the public-API limit, or null
// to proceed. extraHeaders (e.g. CORS) are merged so an allowed origin still
// sees a usable 429 instead of a generic CORS failure.
export function enforceRateLimit(request: Request, extraHeaders?: Record<string, string>): Response | null {
  if (!apiLimiter) return null;
  const { allowed, retryAfterSeconds } = apiLimiter.take(clientIp(request));
  return allowed ? null : limitedResponse(retryAfterSeconds, extraHeaders);
}

// Returns a 429 Response when login attempts from this caller are too frequent.
export function enforceLoginRateLimit(request: Request): Response | null {
  const { allowed, retryAfterSeconds } = loginLimiter.take(clientIp(request));
  return allowed ? null : limitedResponse(retryAfterSeconds);
}
