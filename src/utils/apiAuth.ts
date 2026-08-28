import crypto from 'crypto';

import { timingSafeEqual } from '@/utils/timingSafeEqual';

// Server-side auth gate for the sensitive API routes (/api/system*, /api/alerts*,
// /api/cluster). This runs inside the Node route handlers rather than in edge
// middleware so it reliably reads runtime environment variables (an edge
// middleware can miss env provided only at deploy time) and can hash with
// node:crypto.
//
// The gate is ON when either secret is configured:
//   - API_AUTH_TOKEN  — a shared token usable as an `Authorization: Bearer` for
//     machine-to-machine polling, and set as the cookie value by /login.
//   - DASHBOARD_PASSWORD — a browser login password. On its own it now protects
//     the dashboard too (previously it did nothing unless API_AUTH_TOKEN was also
//     set). The cookie carries a token DERIVED from the password, never the raw
//     password.
//
// When neither is set the gate is open (unchanged default behaviour).

const COOKIE_NAME = 'api_auth_token';

// A fixed application salt. This derivation only has to be deterministic (same
// password -> same token) and non-reversible so the login cookie and the gate
// agree without any shared state; it is not a stored password database, so a
// static salt is appropriate here.
const DERIVATION_SALT = 'servermonitor:v1:session-token';

// scrypt is a deliberately slow, memory-hard KDF, so recovering the password
// from the token by brute force is expensive (unlike a bare SHA-256). The result
// is memoised per password: the value comes from a trusted env var and never
// changes at runtime, so the costly derivation runs once, not on every request.
const derivedCache = new Map<string, string>();

// A stable, non-reversible session token derived from the dashboard password, so
// the raw password never becomes the cookie value.
export function sessionTokenFromPassword(password: string): string {
  const cached = derivedCache.get(password);
  if (cached) return cached;
  const token = crypto.scryptSync(password, DERIVATION_SALT, 32).toString('hex');
  derivedCache.set(password, token);
  return token;
}

// The value a request must present (bearer or cookie) to pass, or null when the
// gate is off. Read from the environment on each call so it always reflects the
// current runtime configuration.
export function expectedSessionToken(): string | null {
  const token = process.env.API_AUTH_TOKEN;
  if (token && token.trim() !== '') return token;
  const password = process.env.DASHBOARD_PASSWORD;
  if (password && password.trim() !== '') return sessionTokenFromPassword(password);
  return null;
}

// What value should /login set in the cookie for the current configuration.
export function sessionCookieValue(): string {
  return expectedSessionToken() ?? '';
}

function presentedToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  // EventSource / fetch send the cookie automatically on same-origin requests.
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)api_auth_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Returns a 401 Response when the request isn't authorized, or null to proceed.
// A no-op when the gate is off.
export function requireApiAuth(request: Request): Response | null {
  const expected = expectedSessionToken();
  if (!expected) return null; // gate off
  if (request.method === 'OPTIONS') return null; // CORS preflight

  const token = presentedToken(request);
  if (token !== null && timingSafeEqual(token, expected)) return null;

  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' }
  });
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
