import { NextRequest, NextResponse } from 'next/server';

import {
  clearOverride,
  getThresholdValues,
  isConfigurableThreshold,
  maxFor,
  setOverride,
  wouldInvertHysteresis
} from '@/utils/collectors/alertOverrides';
import { requireApiAuth } from '@/utils/apiAuth';

// Lets the web UI tune alert thresholds (POST/DELETE) without editing .env and
// restarting the process — alerts.ts's num() reads the override store fresh on
// every evaluation. Same-origin control endpoint; protect it at the network
// layer along with the rest of the app (see README "Securing the API").

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(
    { thresholds: getThresholdValues() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
  if (typeof body.key !== 'string' || !isConfigurableThreshold(body.key)) {
    return NextResponse.json({ error: 'unknown threshold key' }, { status: 400 });
  }
  if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0) {
    return NextResponse.json({ error: 'value must be a non-negative number' }, { status: 400 });
  }
  const max = maxFor(body.key);
  if (max !== undefined && body.value > max) {
    return NextResponse.json({ error: `value must be at most ${max}` }, { status: 400 });
  }
  if (wouldInvertHysteresis(body.key, body.value)) {
    return NextResponse.json(
      { error: 'this value would invert the enter/clear hysteresis relationship' },
      { status: 400 }
    );
  }

  setOverride(body.key, body.value);
  return NextResponse.json({ thresholds: getThresholdValues() });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  if (typeof body.key !== 'string' || !isConfigurableThreshold(body.key)) {
    return NextResponse.json({ error: 'unknown threshold key' }, { status: 400 });
  }

  clearOverride(body.key);
  return NextResponse.json({ thresholds: getThresholdValues() });
}
