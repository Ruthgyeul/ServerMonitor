import { NextResponse } from 'next/server';

import type { LogSourceKind } from '@/types/system';
import { DEFAULT_LOG_LINES, isValidLogSource, readLogs } from '@/utils/collectors/logs';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Recent output of a systemd unit (?kind=unit) or a container (?kind=container)
// for the log drawer. ?name= is validated against the systemd / Docker naming
// rules before anything runs; &lines= caps the tail (max 1000).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
  const requested = Number(params.get('lines'));
  const lines = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_LOG_LINES;

  try {
    return NextResponse.json(
      { success: true, data: await readLogs(kind as LogSourceKind, name, lines) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // journalctl without journal access, or docker without the socket.
    return NextResponse.json(
      { success: false, error: 'Logs are not readable by the monitor (check journal/Docker permissions)' },
      { status: 502 }
    );
  }
}
