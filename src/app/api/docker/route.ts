import { NextResponse } from 'next/server';

import { getDockerDetails } from '@/utils/collectors/dockerDetails';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Container configuration, images, volumes, networks and disk usage for the
// Docker page (live CPU/memory/network come from /api/system). Cached 15s.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  try {
    return NextResponse.json(
      { success: true, data: await getDockerDetails() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Could not read Docker state' }, { status: 500 });
  }
}
