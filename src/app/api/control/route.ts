import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/utils/apiAuth';
import { controlStatus } from '@/utils/control';

// Whether control actions are available, and for which targets, so the UI can
// enable buttons or explain why they're off. See src/utils/control.ts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json(
    { success: true, data: controlStatus() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
