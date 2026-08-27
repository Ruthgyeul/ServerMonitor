import { NextResponse } from 'next/server';

// Clears the dashboard auth cookie set by /api/auth/login.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('api_auth_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  });
  return response;
}
