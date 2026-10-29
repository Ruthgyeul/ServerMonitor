import { NextResponse } from 'next/server';

import { notificationSettings } from '@/utils/collectors/notificationSettings';
import { channelsFor } from '@/utils/collectors/notify';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';
import { rejectCrossSite } from '@/utils/sameOrigin';

// Notification settings for the Notifications page: the webhook switch and the
// level filter. GET also reports whether any webhook URL is configured (the
// URLs themselves stay server-side).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function payload() {
  const configured = (['critical', 'warning', 'info', 'ok'] as const).some(
    level => channelsFor(level).length > 0
  );
  return { settings: notificationSettings().get(), webhookConfigured: configured };
}

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  return NextResponse.json({ success: true, data: payload() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const blocked = requireApiAuth(request) ?? rejectCrossSite(request) ?? enforceRateLimit(request);
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
  notificationSettings().update(body);
  return NextResponse.json({ success: true, data: payload() });
}
