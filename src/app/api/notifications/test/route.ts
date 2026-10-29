import { NextResponse } from 'next/server';

import { sendTestNotification } from '@/utils/collectors/notify';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceActionRateLimit } from '@/utils/rateLimit';
import { rejectCrossSite } from '@/utils/sameOrigin';

// "Send test" on the Notifications page: posts one test message to every
// configured webhook. Held to the strict action rate budget so it can't be
// used to spam a webhook.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const blocked = requireApiAuth(request) ?? rejectCrossSite(request) ?? enforceActionRateLimit(request);
  if (blocked) return blocked;

  try {
    const targets = await sendTestNotification();
    if (targets === 0) {
      return NextResponse.json(
        { success: false, error: 'No webhook configured (set ALERT_WEBHOOK_URL)' },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: { targets } });
  } catch {
    return NextResponse.json({ success: false, error: 'Could not send the test' }, { status: 502 });
  }
}
