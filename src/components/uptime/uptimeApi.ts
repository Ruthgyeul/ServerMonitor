import { refreshPolled } from '@/hooks/usePolled';
import type { UptimeCheck } from '@/types/system';

// Client for /api/uptime. Every call refreshes the shared poll so the page
// (and the sidebar badge) pick up the change without waiting for the next tick.

export const UPTIME_URL = '/api/uptime';
// The sidebar polls a separate key so its slow interval never governs the page's.
export const UPTIME_BADGE_URL = '/api/uptime?for=badge';

export interface UptimeList {
  checks: UptimeCheck[];
}

interface Result<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function call<T>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const parsed = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
      error?: string;
    } | null;
    if (!response.ok || !parsed?.success) return { ok: false, error: parsed?.error ?? 'Request failed' };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: 'Network error' };
  } finally {
    refreshPolled(UPTIME_URL);
    refreshPolled(UPTIME_BADGE_URL);
  }
}

export function addCheck(input: { name: string; url: string; intervalSec: number }) {
  return call<UptimeCheck>(UPTIME_URL, 'POST', input);
}

export function checkNow(id: string) {
  return call<UptimeCheck>(`${UPTIME_URL}/${encodeURIComponent(id)}`, 'PATCH', { action: 'check' });
}

export function setPaused(id: string, paused: boolean) {
  return call<{ id: string }>(`${UPTIME_URL}/${encodeURIComponent(id)}`, 'PATCH', { paused });
}

export function removeCheck(id: string) {
  return call<{ id: string }>(`${UPTIME_URL}/${encodeURIComponent(id)}`, 'DELETE');
}
