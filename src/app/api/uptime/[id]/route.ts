import { NextResponse } from 'next/server';

import { uptime } from '@/utils/collectors/uptime';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';
import { rejectCrossSite } from '@/utils/sameOrigin';

// One uptime check. PATCH { paused: boolean } pauses/resumes it,
// PATCH { action: 'check' } probes it right away; DELETE removes it.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

function guard(request: Request): Response | null {
  return requireApiAuth(request) ?? rejectCrossSite(request) ?? enforceRateLimit(request);
}

const NOT_FOUND = { success: false, error: 'Check not found' } as const;

export async function PATCH(request: Request, context: Context) {
  const blocked = guard(request);
  if (blocked) return blocked;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const service = uptime();

  if (body?.action === 'check') {
    const check = await service.runNow(id);
    return check
      ? NextResponse.json({ success: true, data: check })
      : NextResponse.json(NOT_FOUND, { status: 404 });
  }
  if (typeof body?.paused === 'boolean') {
    return service.setPaused(id, body.paused)
      ? NextResponse.json({ success: true, data: { id, paused: body.paused } })
      : NextResponse.json(NOT_FOUND, { status: 404 });
  }
  return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
}

export async function DELETE(request: Request, context: Context) {
  const blocked = guard(request);
  if (blocked) return blocked;

  const { id } = await context.params;
  return uptime().remove(id)
    ? NextResponse.json({ success: true, data: { id } })
    : NextResponse.json(NOT_FOUND, { status: 404 });
}
