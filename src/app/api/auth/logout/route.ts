import { NextRequest, NextResponse } from 'next/server';

import { isHttps } from '@/utils/requestScheme';

// Clears the dashboard auth cookie set by /api/auth/login.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('api_auth_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: '/',
    maxAge: 0
  });
  return response;
}
