import { refreshPolled } from '@/hooks/usePolled';
import type { NotificationSettings } from '@/utils/collectors/notificationSettings';

// Client for /api/notifications (settings) and /api/notifications/test.

export const NOTIFY_URL = '/api/notifications';

export interface NotificationsInfo {
  settings: NotificationSettings;
  webhookConfigured: boolean;
}

async function post<T>(url: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
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
  }
}

export async function updateNotificationSettings(patch: Partial<NotificationSettings>) {
  const result = await post<NotificationsInfo>(NOTIFY_URL, patch);
  refreshPolled(NOTIFY_URL);
  return result;
}

export function sendTestNotification() {
  return post<{ targets: number }>(`${NOTIFY_URL}/test`);
}
