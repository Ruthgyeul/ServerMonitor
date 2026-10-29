import { NextResponse } from 'next/server';

import { listJobs } from '@/utils/collectors/jobs';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Backups and scheduled jobs (systemd timers) with their last result, next run
// and recent history. Cached for 30s server-side.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  try {
    return NextResponse.json(
      { success: true, data: await listJobs() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Could not list jobs' }, { status: 500 });
  }
}
