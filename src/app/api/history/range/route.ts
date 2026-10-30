import { NextResponse } from 'next/server';

import {
  getRange,
  HISTORY_METRICS,
  HOUR_MS,
  QUARTER_MS,
  type HistoryMetric,
  type Stat
} from '@/utils/collectors/history';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Bucketed values of one metric for an arbitrary window, for the Compare page:
// ?metric=cpu|mem|disk|net|load|…&from=<epoch ms>&to=<epoch ms>
// &step=1h|15m (default 1h) &stat=avg|max (default avg).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const STEPS: Record<string, { ms: number; maxSpanMs: number; label: string }> = {
  '1h': { ms: HOUR_MS, maxSpanMs: 400 * DAY_MS, label: '400 days' },
  '15m': { ms: QUARTER_MS, maxSpanMs: 8 * DAY_MS, label: '8 days' }
};
const STATS: readonly Stat[] = ['avg', 'max'];

const isMetric = (value: string | null): value is HistoryMetric =>
  value !== null && (HISTORY_METRICS as readonly string[]).includes(value);

const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 });

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const metric = params.get('metric');
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  const step = STEPS[params.get('step') ?? '1h'];
  const stat = (params.get('stat') ?? 'avg') as Stat;
  if (!isMetric(metric)) return badRequest(`metric must be one of ${HISTORY_METRICS.join(', ')}`);
  if (!step) return badRequest('step must be 1h or 15m');
  if (!STATS.includes(stat)) return badRequest('stat must be avg or max');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > step.maxSpanMs) {
    return badRequest(`from/to must span up to ${step.label}`);
  }
  return NextResponse.json(
    { success: true, data: getRange(metric, from, to, step.ms, stat) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
