import { NextResponse } from 'next/server';

import { getMetricSeries, isHistoryRange } from '@/utils/collectors/metricSeries';
import { requireApiAuth } from '@/utils/apiAuth';

// Chart series for the overview: CPU/memory/disk % and download/upload KB/s,
// bucketed for the requested range (1h, 6h, 24h, 7d). Reads in-process state
// only, so it's cheap to poll.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  const range = new URL(request.url).searchParams.get('range') ?? '1h';
  if (!isHistoryRange(range)) {
    return NextResponse.json(
      { success: false, error: 'range must be one of 1h, 6h, 24h, 7d' },
      { status: 400 }
    );
  }
  return NextResponse.json(
    { success: true, data: getMetricSeries(range) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
