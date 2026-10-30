import { NextResponse } from 'next/server';

import type { LogSourceKind } from '@/types/system';
import { openLogStream, streamSlots } from '@/utils/collectors/logStream';
import { isValidLogSource } from '@/utils/collectors/logs';
import { requireApiAuth } from '@/utils/apiAuth';
import { clientIp, enforceRateLimit } from '@/utils/rateLimit';

// Follow a unit's journal (?kind=unit) or a container's output
// (?kind=container) as Server-Sent Events. Same name validation as /api/logs;
// at most two open streams per client, each ending after 30 minutes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  const name = params.get('name') ?? '';
  if ((kind !== 'unit' && kind !== 'container') || !isValidLogSource(kind as LogSourceKind, name)) {
    return NextResponse.json({ success: false, error: 'Unknown log source' }, { status: 400 });
  }

  const client = clientIp(request);
  const slots = streamSlots();
  if (!slots.acquire(client)) {
    return NextResponse.json({ success: false, error: 'Too many open log streams' }, { status: 429 });
  }
  try {
    const stream = openLogStream(kind as LogSourceKind, name, {
      signal: request.signal,
      onClose: () => slots.release(client)
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    });
  } catch {
    slots.release(client);
    return NextResponse.json({ success: false, error: 'Could not follow this log' }, { status: 502 });
  }
}
