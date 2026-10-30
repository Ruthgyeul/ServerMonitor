import { NextResponse } from 'next/server';

import { getHostEvents } from '@/utils/collectors/events';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Host events (reboots, container deploys/restarts) for chart markers.
// ?days= limits the window (default 7, max 30).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 30;
const DEFAULT_DAYS = 7;

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const raw = Number(new URL(request.url).searchParams.get('days'));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_DAYS, raw) : DEFAULT_DAYS;
  return NextResponse.json(
    { success: true, data: getHostEvents(days * DAY_MS) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
