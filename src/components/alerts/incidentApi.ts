import { INCIDENTS_URL } from '@/components/alerts/incidentView';
import { refreshPolled } from '@/hooks/usePolled';
import type { Incident, IncidentAction } from '@/utils/collectors/incidents';

// Client for POST /api/incidents/[id]. Refreshes the shared polls afterwards.
export async function actOnIncident(
  id: string,
  action: IncidentAction,
  note = ''
): Promise<{ ok: boolean; error?: string; incident?: Incident }> {
  try {
    const response = await fetch(`${INCIDENTS_URL}/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note })
    });
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: Incident;
      error?: string;
    } | null;
    if (!response.ok || !body?.success) return { ok: false, error: body?.error ?? 'Request failed' };
    return { ok: true, incident: body.data };
  } catch {
    return { ok: false, error: 'Network error' };
  } finally {
    refreshPolled(INCIDENTS_URL);
    refreshPolled(`${INCIDENTS_URL}/${encodeURIComponent(id)}`);
  }
}
