import { NextRequest, NextResponse } from 'next/server';

import {
  CONFIGURABLE_THRESHOLDS,
  clearOverride,
  getAllOverrides,
  isConfigurableThreshold,
  setOverride
} from '@/utils/collectors/alertOverrides';
import { requireApiAuth } from '@/utils/apiAuth';

// Lets the web UI tune alert thresholds (POST/DELETE) without editing .env and
// restarting the process — alerts.ts's num() reads the override store fresh on
// every evaluation. Same-origin control endpoint; protect it at the network
// layer along with the rest of the app (see README "Securing the API").

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentValues() {
  const overrides = getAllOverrides();
  return CONFIGURABLE_THRESHOLDS.map(threshold => {
    const override = overrides[threshold.key];
    const raw = process.env[threshold.key];
    const envValue =
      raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
    return {
      key: threshold.key,
      label: threshold.label,
      default: threshold.default,
      envValue,
      override: override ?? null,
      // What actually applies right now, same precedence as alerts.ts's num().
      value: override ?? envValue ?? threshold.default
    };
  });
}

export function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ thresholds: currentValues() }, { headers: { 'Cache-Control': 'no-store' } });
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

  setOverride(body.key, body.value);
  return NextResponse.json({ thresholds: currentValues() });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  if (typeof body.key !== 'string' || !isConfigurableThreshold(body.key)) {
    return NextResponse.json({ error: 'unknown threshold key' }, { status: 400 });
  }

  clearOverride(body.key);
  return NextResponse.json({ thresholds: currentValues() });
}
