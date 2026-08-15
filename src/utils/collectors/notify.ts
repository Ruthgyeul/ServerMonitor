import { AlertEntry } from '@/types/system';
import { logger } from '@/utils/logger';

// Until now alerts only showed on the dashboard's alert card. Unless someone
// watches a wall panel 24/7, a threshold breach goes unnoticed. Here we push
// once per alert transition to an external endpoint. It only acts when
// ALERT_WEBHOOK_URL is set; unset (the default) is a complete no-op, so
// existing deployments are unaffected.

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
// json    — POST the AlertEntry as-is (for a custom receiver / webhook bridge)
// slack   — Slack Incoming Webhook shape, { text }
// discord — Discord Webhook shape, { content }
const WEBHOOK_FORMAT = (process.env.ALERT_WEBHOOK_FORMAT || 'json').toLowerCase();

// The collection loop runs every second on a sensitive path. Cap the request
// so a slow or dead webhook can't hold the loop up (same approach as the cluster fetch).
const TIMEOUT_MS = 5000;

// Maps the UI levels to a human-readable prefix, shown at the head of Slack/Discord messages.
const LEVEL_PREFIX: Record<AlertEntry['level'], string> = {
  ok: '✅',
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🚨'
};

function formatPayload(entry: AlertEntry): string {
  const prefix = LEVEL_PREFIX[entry.level] ?? '';
  const host = process.env.NEXT_PUBLIC_SITE_SHORT_NAME || 'ServerMonitor';
  const text = `${prefix} [${host}] ${entry.message}`;

  switch (WEBHOOK_FORMAT) {
    case 'slack':
      return JSON.stringify({ text });
    case 'discord':
      return JSON.stringify({ content: text });
    default:
      return JSON.stringify(entry);
  }
}

/**
 * Pushes a single new alert to the configured webhook. Always resolves (a
 * failure is only logged) so the caller can fire-and-forget without depending
 * on delivery/success. Spam suppression (hysteresis / no notify on first
 * evaluation) is already handled by the caller (alerts.ts).
 */
export async function dispatchAlert(entry: AlertEntry): Promise<void> {
  if (!WEBHOOK_URL) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: formatPayload(entry),
      signal: controller.signal
    });
  } catch (error) {
    // A webhook failure is not fatal; the alert still lives on the dashboard/log.
    const message = error instanceof Error ? error.message : String(error);
    logger.error('alerts webhook dispatch failed:', message);
  } finally {
    clearTimeout(timeout);
  }
}
