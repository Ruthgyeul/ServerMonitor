// Client for /api/alerts/config (the per-key threshold overrides).

export interface Threshold {
  key: string;
  label: string;
  default: number;
  envValue: number | null;
  override: number | null;
  value: number;
}

type Result = { ok: true; thresholds: Threshold[] } | { ok: false; error: string };

async function call(method: 'GET' | 'POST' | 'DELETE', body?: object): Promise<Result> {
  try {
    const response = await fetch('/api/alerts/config', {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = (await response.json().catch(() => ({}))) as { thresholds?: Threshold[]; error?: string };
    if (!response.ok || !payload.thresholds)
      return { ok: false, error: payload.error ?? `HTTP ${response.status}` };
    return { ok: true, thresholds: payload.thresholds };
  } catch {
    return { ok: false, error: 'Could not reach the server' };
  }
}

export const loadThresholds = () => call('GET');

// Write one key. A value equal to what applies without an override (env, else
// default) clears the override instead, so "overridden" means a real change.
export function writeThreshold(threshold: Threshold, value: number): Promise<Result> {
  const baseline = threshold.envValue ?? threshold.default;
  return value === baseline
    ? call('DELETE', { key: threshold.key })
    : call('POST', { key: threshold.key, value });
}

export const clearThreshold = (key: string) => call('DELETE', { key });
