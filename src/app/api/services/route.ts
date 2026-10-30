import { NextResponse } from 'next/server';

import { listServiceUnits } from '@/utils/collectors/services';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Every loaded systemd service with its state and when it last started, for
// the Services page. Cached for 10s server-side.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  try {
    return NextResponse.json(
      { success: true, data: await listServiceUnits() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Could not list services' }, { status: 500 });
  }
}
