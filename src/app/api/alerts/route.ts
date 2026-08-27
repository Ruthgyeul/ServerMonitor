import { NextResponse } from 'next/server';

import { getAlertLog } from '@/utils/collectors/alerts';

// The persisted alert log for the /alerts history page. Reads process/on-disk
// state only (no host collection), so it's cheap and safe to poll.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ alerts: getAlertLog() }, { headers: { 'Cache-Control': 'no-store' } });
}
