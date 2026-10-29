import { NextResponse } from 'next/server';

import { uptime } from '@/utils/collectors/uptime';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';
import { rejectCrossSite } from '@/utils/sameOrigin';

// HTTP uptime checks. GET lists every check with its last 60 results; POST
// adds one ({ name?, url, intervalSec }). Probing runs server-side on its own
// schedule, so results keep accumulating with no browser open.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const service = uptime();
  service.start();
  return NextResponse.json(
    { success: true, data: { checks: service.list() } },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const service = uptime();
  service.start();
  const result = service.add({
    name: typeof body.name === 'string' ? body.name : '',
    url: typeof body.url === 'string' ? body.url : '',
    intervalSec: typeof body.intervalSec === 'number' ? body.intervalSec : NaN
  });
  if (typeof result === 'string') {
    return NextResponse.json({ success: false, error: result }, { status: 400 });
  }
  return NextResponse.json({ success: true, data: result }, { status: 201 });
}
