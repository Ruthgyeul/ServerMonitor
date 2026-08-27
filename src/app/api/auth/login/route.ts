import { NextRequest, NextResponse } from 'next/server';

import { timingSafeEqual } from '@/utils/timingSafeEqual';

// Optional login that lets a secured API and the browser dashboard coexist.
//
// When API_AUTH_TOKEN is set, proxy.ts gates /api/system* — but EventSource
// can't attach a bearer token, so the dashboard breaks. The proxy already
// accepts the token from an `api_auth_token` cookie, which the browser DOES send
// automatically on same-origin requests. This route verifies DASHBOARD_PASSWORD
// and, on success, drops that cookie as HttpOnly (so the token itself never
// reaches client JS). The dashboard then streams normally while curl without the
// cookie/token still gets 401.
//
// Disabled unless DASHBOARD_PASSWORD is set — existing unauthenticated
// deployments are unaffected.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PASSWORD = process.env.DASHBOARD_PASSWORD;
const TOKEN = process.env.API_AUTH_TOKEN;

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
  if (!PASSWORD) {
    // Feature off. Nothing to log in to.
    return NextResponse.json({ error: 'Login is not enabled' }, { status: 404 });
  }

  const password = await readPassword(request);
  if (!password || !timingSafeEqual(password, PASSWORD)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  // If no API token is configured the gate is open anyway; still set a cookie so
  // the flow is consistent, but it only matters when API_AUTH_TOKEN is set.
  response.cookies.set('api_auth_token', TOKEN ?? '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7 // a week
  });
  return response;
}
