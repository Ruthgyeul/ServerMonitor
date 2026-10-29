import { NextResponse } from 'next/server';

import { getHourlyRange, type HourlyMetric } from '@/utils/collectors/history';
import { requireApiAuth } from '@/utils/apiAuth';

// Hourly averages of one metric for an arbitrary window, for the Compare page:
// ?metric=cpu|mem|disk|net|load&from=<epoch ms>&to=<epoch ms>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const METRICS: readonly HourlyMetric[] = ['cpu', 'mem', 'disk', 'net', 'load'];
const MAX_SPAN_MS = 62 * 24 * 60 * 60 * 1000;

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  const params = new URL(request.url).searchParams;
  const metric = params.get('metric') as HourlyMetric | null;
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  if (!metric || !METRICS.includes(metric)) {
    return NextResponse.json(
      { success: false, error: 'metric must be one of cpu, mem, disk, net, load' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_SPAN_MS) {
    return NextResponse.json({ success: false, error: 'from/to must span up to 62 days' }, { status: 400 });
  }
  return NextResponse.json(
    { success: true, data: getHourlyRange(metric, from, to) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
