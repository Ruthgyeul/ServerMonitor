import { NextRequest, NextResponse } from 'next/server';

import { timingSafeEqual } from '@/utils/timingSafeEqual';
import { enforceLoginRateLimit } from '@/utils/rateLimit';
import { isHttps } from '@/utils/requestScheme';
import { sessionCookieValue } from '@/utils/apiAuth';

// Optional login that lets a secured API and the browser dashboard coexist.
//
// The API routes gate /api/system* (and friends) whenever a secret is set —
// but EventSource can't attach a bearer token, so the dashboard would break.
// The gate also accepts an `api_auth_token` cookie, which the browser DOES send
// automatically on same-origin requests. This route verifies DASHBOARD_PASSWORD
// and, on success, drops that cookie as HttpOnly (so the token itself never
// reaches client JS). The dashboard then streams normally while curl without the
// cookie/token still gets 401.
//
// The cookie value is whatever the gate expects: the raw API_AUTH_TOKEN when set,
// otherwise a token DERIVED from DASHBOARD_PASSWORD (so the raw password is never
// the cookie value). Setting DASHBOARD_PASSWORD alone is now enough to protect
// the dashboard.
//
// Disabled unless DASHBOARD_PASSWORD is set — existing unauthenticated
// deployments are unaffected.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readPassword(request: NextRequest): Promise<string> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { password?: unknown };
    return typeof body.password === 'string' ? body.password : '';
  }
  const form = await request.formData().catch(() => null);
  const value = form?.get('password');
  return typeof value === 'string' ? value : '';
}

export async function POST(request: NextRequest) {
  // Read per-request so the route reflects the current runtime configuration.
  const configuredPassword = process.env.DASHBOARD_PASSWORD;
  if (!configuredPassword) {
    // Feature off. Nothing to log in to.
    return NextResponse.json({ error: 'Login is not enabled' }, { status: 404 });
  }

  // Slow down password guessing before doing any comparison.
  const limited = enforceLoginRateLimit(request);
  if (limited) return limited;

  const password = await readPassword(request);
  if (!password || !timingSafeEqual(password, configuredPassword)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  // The cookie carries the value the gate expects: the raw API_AUTH_TOKEN when
  // set, otherwise the token derived from DASHBOARD_PASSWORD. Stored HttpOnly so
  // it never reaches client JS. Secure is keyed to the observed scheme so a
  // plain-HTTP LAN deployment can still receive (and keep) the cookie.
  response.cookies.set('api_auth_token', sessionCookieValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: '/',
    maxAge: 60 * 60 * 24 * 7 // a week
  });
  return response;
}
