import { NextRequest, NextResponse } from 'next/server';

// /api/system* returns sensitive reconnaissance: SSH source IPs/usernames, the
// full process list, open ports, traffic peer IPs, firewall state. CORS only
// blocks a browser's cross-origin "read"; a non-browser client like curl reads it freely.
//
// So there's an optional shared-token gate. When API_AUTH_TOKEN is set, every
// /api/system* request must present that token. When unset (the default) the
// behavior is exactly as before — but you must then protect it at the network
// level (local binding/VPN/reverse proxy) (see README).
//
// Note: enabling the token breaks the built-in browser dashboard (which calls
// /api/system/stream from the same origin) because it can't attach a token.
// This mode is for a deployment where a reverse proxy injects the token, or for machine-to-machine polling.

const AUTH_TOKEN = process.env.API_AUTH_TOKEN;

// Make the time taken as uniform as possible whether the length or value
// differs, to make it hard to recover the token one character at a time via a timing side channel.
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // Iterate over the longer length so the same number of bytes is compared even when lengths differ.
  const length = Math.max(aBytes.length, bBytes.length);
  let mismatch = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return mismatch === 0;
}

function presentedToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  // EventSource can't attach custom headers, so a cookie path is also allowed (injected by a proxy).
  const cookie = request.cookies.get('api_auth_token')?.value;
  return cookie ?? null;
}

export function proxy(request: NextRequest) {
  // If no token is set, leave the gate open (preserving prior behavior).
  if (!AUTH_TOKEN) return NextResponse.next();

  // Preflight isn't subject to auth. Check it on the real request.
  if (request.method === 'OPTIONS') return NextResponse.next();

  const token = presentedToken(request);
  if (token && timingSafeEqual(token, AUTH_TOKEN)) {
    return NextResponse.next();
  }

  return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer'
    }
  });
}

export const config = {
  matcher: ['/api/system', '/api/system/:path*']
};
