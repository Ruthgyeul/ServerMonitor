import { NextResponse } from 'next/server';

import type { ActionResult } from '@/utils/collectors/controlActions';

// Shared response shape for the control routes.
export function actionResponse(result: ActionResult): Response {
  return result.ok
    ? NextResponse.json({ success: true, data: { message: result.message } })
    : NextResponse.json({ success: false, error: result.message }, { status: 502 });
}

export function badRequest(error: string): Response {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

// The `action` / `kind` field of a JSON body, if it is one of `allowed`.
export async function pickField<T extends string>(
  request: Request,
  field: string,
  allowed: readonly T[]
): Promise<T | null> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const value = body?.[field];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
