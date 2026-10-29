import { usePolled } from '@/hooks/usePolled';
import type { ControlStatus } from '@/utils/control';

// Client side of the opt-in control actions: what is allowed (GET /api/control)
// and the POST/DELETE calls.

export const CONTROL_URL = '/api/control';
const STATUS_POLL_MS = 5 * 60_000;

export type ControlKind = 'container' | 'unit' | 'prune';

export interface Permission {
  allowed: boolean;
  reason: string | null;
}

// Pure: may this target be controlled, and if not, why (for the tooltip)?
export function permissionFor(status: ControlStatus | null, kind: ControlKind, name = ''): Permission {
  if (!status) return { allowed: false, reason: 'Checking control settings…' };
  if (!status.enabled) return { allowed: false, reason: status.reason };
  if (kind === 'prune') {
    return status.prune
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'Set CONTROL_ALLOW_PRUNE=true to prune or remove images' };
  }
  const list = kind === 'container' ? status.containers : status.units;
  const envKey = kind === 'container' ? 'CONTROL_ALLOWLIST_CONTAINERS' : 'CONTROL_ALLOWLIST_UNITS';
  return list === '*' || list.includes(name)
    ? { allowed: true, reason: null }
    : { allowed: false, reason: `Add ${name} to ${envKey} to control it` };
}

export function useControlStatus(): ControlStatus | null {
  return usePolled<ControlStatus>(CONTROL_URL, STATUS_POLL_MS);
}

export async function sendControl(
  url: string,
  body?: Record<string, string>,
  method: 'POST' | 'DELETE' = 'POST'
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const parsed = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: { message: string };
      error?: string;
    } | null;
    if (!response.ok || !parsed?.success) return { ok: false, message: parsed?.error ?? 'Request failed' };
    return { ok: true, message: parsed.data?.message ?? 'Done' };
  } catch {
    return { ok: false, message: 'Network error' };
  }
}

export const containerUrl = (name: string) => `/api/control/docker/${encodeURIComponent(name)}`;
export const imageUrl = (id: string) => `/api/control/docker/images/${encodeURIComponent(id)}`;
export const PRUNE_URL = '/api/control/docker/prune';
export const unitUrl = (name: string) => `/api/control/units/${encodeURIComponent(name)}`;
export const jobUrl = (id: string) => `/api/control/jobs/${encodeURIComponent(id)}`;
