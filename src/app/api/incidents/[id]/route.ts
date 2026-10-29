import { NextResponse } from 'next/server';

import { incidents, type IncidentAction } from '@/utils/collectors/incidents';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';
import { rejectCrossSite } from '@/utils/sameOrigin';

// One incident. POST { action: 'ack' | 'note' | 'resolve' | 'reopen', note? }
// adds to its timeline.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

const ACTIONS: IncidentAction[] = ['ack', 'note', 'resolve', 'reopen'];
const NOT_FOUND = { success: false, error: 'Incident not found' } as const;

export async function GET(request: Request, context: Context) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const incident = incidents().get((await context.params).id);
  return incident
    ? NextResponse.json({ success: true, data: incident }, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json(NOT_FOUND, { status: 404 });
}

export async function POST(request: Request, context: Context) {
  const blocked = requireApiAuth(request) ?? rejectCrossSite(request) ?? enforceRateLimit(request);
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action as IncidentAction)) {
    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note : '';

  const result = incidents().act((await context.params).id, action as IncidentAction, note);
  if (result === null) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (typeof result === 'string')
    return NextResponse.json({ success: false, error: result }, { status: 400 });
  return NextResponse.json({ success: true, data: result });
}
