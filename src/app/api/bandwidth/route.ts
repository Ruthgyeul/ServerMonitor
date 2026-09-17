import { NextResponse } from 'next/server';

import { getBandwidthHistory } from '@/utils/collectors/bandwidth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Daily download/upload totals for the monthly-usage card. Unlike /api/system
// this carries no reconnaissance data (no IPs, ports, or process names) — just
// aggregate byte counts — so, like /api/metrics, it isn't behind requireApiAuth.
// Polled at a much lower frequency than the 1s SSE stream, so it's a separate
// endpoint rather than another field on every /api/system response.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;

export async function GET(request: Request) {
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const url = new URL(request.url);
  const raw = Number(url.searchParams.get('days'));
  // Math.floor(0.5) is 0, not "invalid" — clamp the floored value up to 1
  // rather than letting a fractional query param silently return no days.
  const days =
    Number.isFinite(raw) && raw > 0 ? Math.min(MAX_DAYS, Math.max(1, Math.floor(raw))) : DEFAULT_DAYS;

  return NextResponse.json({ days: getBandwidthHistory(days) }, { headers: { 'Cache-Control': 'no-store' } });
}
