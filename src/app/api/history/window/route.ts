import { NextResponse } from 'next/server';

import type { WindowMetric } from '@/types/system';
import { getMetricWindow } from '@/utils/collectors/metricSeries';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// One metric around an arbitrary window (an incident's span plus margins), at
// the finest resolution still kept for it: minutes, then 15-minute, then
// hourly buckets. ?metric=cpu|mem|disk|temp|swap|load|net&from=<ms>&to=<ms>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const METRICS: readonly WindowMetric[] = ['cpu', 'mem', 'disk', 'temp', 'swap', 'load', 'net'];
const MAX_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

const isMetric = (value: string | null): value is WindowMetric =>
  value !== null && (METRICS as readonly string[]).includes(value);

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const metric = params.get('metric');
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  if (!isMetric(metric)) {
    return NextResponse.json(
      { success: false, error: `metric must be one of ${METRICS.join(', ')}` },
      { status: 400 }
    );
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_SPAN_MS) {
    return NextResponse.json({ success: false, error: 'from/to must span up to 31 days' }, { status: 400 });
  }
  return NextResponse.json(
    { success: true, data: getMetricWindow(metric, from, to) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
