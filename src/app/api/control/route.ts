import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';
import { controlStatus } from '@/utils/control';

// Whether control actions are available, and for which targets, so the UI can
// enable buttons or explain why they're off. See src/utils/control.ts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  return NextResponse.json(
    { success: true, data: controlStatus() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
