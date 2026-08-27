import { NextRequest, NextResponse } from 'next/server';

import { clearMute, muteAll, muteKey, muteStatus } from '@/utils/collectors/alertMute';

// Manual alert muting ("snooze"), e.g. during maintenance. Muting suppresses the
// external webhook only — the on-screen alert log keeps recording. Same-origin
// control endpoint used by the dashboard; protect it at the network layer along
// with the rest of the app (see README "Securing the API").

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(muteStatus(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { minutes?: unknown; key?: unknown };
  const minutes = typeof body.minutes === 'number' && Number.isFinite(body.minutes) ? body.minutes : 60;
  if (minutes <= 0) {
    return NextResponse.json({ error: 'minutes must be positive' }, { status: 400 });
  }

  if (typeof body.key === 'string' && body.key.trim() !== '') {
    muteKey(body.key.trim(), minutes);
  } else {
    muteAll(minutes);
  }
  return NextResponse.json(muteStatus());
}

export function DELETE() {
  clearMute();
  return NextResponse.json(muteStatus());
}
