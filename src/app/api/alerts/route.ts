import { NextResponse } from 'next/server';

import { getAlertLog } from '@/utils/collectors/alerts';
import { requireApiAuth } from '@/utils/apiAuth';

// The persisted alert log for the /alerts history page. Reads process/on-disk
// state only (no host collection), so it's cheap and safe to poll.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ alerts: getAlertLog() }, { headers: { 'Cache-Control': 'no-store' } });
}
