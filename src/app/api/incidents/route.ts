import { NextResponse } from 'next/server';

import { incidents } from '@/utils/collectors/incidents';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Every incident (newest first): opened when an alert fires, resolved when it
// recovers or an operator resolves it.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  return NextResponse.json(
    { success: true, data: { incidents: incidents().list() } },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
