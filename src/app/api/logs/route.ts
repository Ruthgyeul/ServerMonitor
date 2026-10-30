import { NextResponse } from 'next/server';

import type { LogSourceKind } from '@/types/system';
import {
  DEFAULT_LOG_LINES,
  isInvocationId,
  isValidLogSource,
  parseSince,
  readLogTail,
  type LogScope
} from '@/utils/collectors/logs';
import { requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';

// Recent output of a systemd unit (?kind=unit) or a container (?kind=container)
// for the log drawer, plus whether the source is still running. ?name= is
// validated against the systemd / Docker naming rules before anything runs;
// &lines= caps the tail (max 1000). One run only: &invocation=<systemd
// InvocationID> (units) or &since=<ISO 8601>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 });

export async function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  const name = params.get('name') ?? '';
  if ((kind !== 'unit' && kind !== 'container') || !isValidLogSource(kind as LogSourceKind, name)) {
    return badRequest('Unknown log source');
  }
  const requested = Number(params.get('lines'));
  const lines = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_LOG_LINES;

  const scope: LogScope = {};
  const invocation = params.get('invocation');
  if (invocation !== null) {
    if (kind !== 'unit' || !isInvocationId(invocation))
      return badRequest('invocation must be a systemd InvocationID');
    scope.invocation = invocation;
  }
  const since = params.get('since');
  if (since !== null) {
    scope.since = parseSince(since);
    if (scope.since === null) return badRequest('since must be an ISO 8601 time');
  }

  try {
    return NextResponse.json(
      { success: true, data: await readLogTail(kind as LogSourceKind, name, lines, scope) },
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
