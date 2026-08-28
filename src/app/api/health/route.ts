import os from 'os';
import { NextResponse } from 'next/server';

import { getLoopHealth } from '@/utils/systemStream';

// Lightweight health check. /api/system collects heavy reconnaissance (SSH
// IPs, the process list, ...), which is overkill for a container
// orchestration/uptime probe. This route triggers no collection and returns
// process liveness and the collection loop's health immediately.
//
// The auth gate only applies to the sensitive routes (/api/system*, /api/alerts*,
// /api/cluster); this path is outside it — an orchestrator can probe it without
// a token. It exposes no sensitive data.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const loop = getLoopHealth();

  // If the loop is running but the last tick is too old, or failures are
  // piling up, report degraded (HTTP stays 200 so a probe doesn't kill the process).
  const stalled = loop.running && loop.lastTickAgeMs !== null && loop.lastTickAgeMs > 60_000;
  const failing = loop.consecutiveFailures >= 5;
  const status = stalled || failing ? 'degraded' : 'ok';

  return NextResponse.json(
    {
      status,
      uptime: Math.floor(os.uptime()),
      loop,
      timestamp: new Date().toISOString()
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
