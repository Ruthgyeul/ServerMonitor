import { AlertEntry, AlertLevel } from '@/types/system';
import { logger } from '@/utils/logger';
import { isMuted } from '@/utils/collectors/alertMute';

// Alerts only showed on the dashboard's alert card until now. Unless someone
// watches a wall panel 24/7, a threshold breach goes unnoticed. Here we push
// alert transitions to one or more external webhooks. Everything is off by
// default (no ALERT_WEBHOOK_URL) so existing deployments are unaffected.
//
// Channels: ALERT_WEBHOOK_URL is the default target(s), comma-separated. A
// per-severity override — ALERT_WEBHOOK_URL_CRITICAL / _WARNING / _INFO / _OK —
// routes that level elsewhere (e.g. critical to PagerDuty, warnings to Slack),
// falling back to the default when unset.
//
// Batching (opt-in): ALERT_BATCH_MS > 0 collects alerts that fire within a short
// window into one combined message per channel, so a burst doesn't page N times.
// Left at 0 (default) each alert is sent immediately.

const WEBHOOK_FORMAT = (process.env.ALERT_WEBHOOK_FORMAT || 'json').toLowerCase();
const TIMEOUT_MS = 5000;
const BATCH_MS = Number(process.env.ALERT_BATCH_MS) || 0;

const LEVEL_PREFIX: Record<AlertLevel, string> = {
  ok: '✅',
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🚨'
};

function splitUrls(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean);
}

const DEFAULT_URLS = splitUrls(process.env.ALERT_WEBHOOK_URL);
const LEVEL_ENV: Record<AlertLevel, string> = {
  ok: 'ALERT_WEBHOOK_URL_OK',
  info: 'ALERT_WEBHOOK_URL_INFO',
  warning: 'ALERT_WEBHOOK_URL_WARNING',
  critical: 'ALERT_WEBHOOK_URL_CRITICAL'
};

// The webhook targets for a given severity: its per-level override if set,
// otherwise the default list.
export function channelsFor(level: AlertLevel): string[] {
  const override = splitUrls(process.env[LEVEL_ENV[level]]);
  return override.length > 0 ? override : DEFAULT_URLS;
}

const HOST = () => process.env.NEXT_PUBLIC_SITE_SHORT_NAME || 'ServerMonitor';

function formatLine(entry: AlertEntry): string {
  return `${LEVEL_PREFIX[entry.level] ?? ''} [${HOST()}] ${entry.message}`;
}

// Build the request body for one or more entries in the configured shape.
export function formatPayload(entries: AlertEntry[]): string {
  const text = entries.map(formatLine).join('\n');
  switch (WEBHOOK_FORMAT) {
    case 'slack':
      return JSON.stringify({ text });
    case 'discord':
      return JSON.stringify({ content: text });
    default:
      // Raw JSON: a single entry stays an object (unchanged from before); a
      // batch becomes an array.
      return JSON.stringify(entries.length === 1 ? entries[0] : entries);
  }
}

async function postTo(url: string, body: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('alerts webhook dispatch failed:', message);
  } finally {
    clearTimeout(timeout);
  }
}

// Send one entry immediately to every channel configured for its level.
async function sendNow(entry: AlertEntry): Promise<void> {
  const body = formatPayload([entry]);
  await Promise.all(channelsFor(entry.level).map(url => postTo(url, body)));
}

// --- Batching ------------------------------------------------------------
let queue: AlertEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, BATCH_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

async function flushQueue(): Promise<void> {
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;

  // Muting (manual or quiet hours) may have started after these were queued.
  // Re-check the global/time-based mute at flush time so we don't page during a
  // window that is meant to suppress notifications. (Per-key mute was already
  // applied when each entry was enqueued in alerts.ts.)
  if (isMuted(null)) return;

  // Group by channel URL so each target receives one combined message, using the
  // highest-severity format of the entries routed to it.
  const byUrl = new Map<string, AlertEntry[]>();
  for (const entry of batch) {
    for (const url of channelsFor(entry.level)) {
      const list = byUrl.get(url) ?? [];
      list.push(entry);
      byUrl.set(url, list);
    }
  }
  await Promise.all([...byUrl.entries()].map(([url, entries]) => postTo(url, formatPayload(entries))));
}

/**
 * Pushes a single new alert to the configured webhook(s). Always resolves (a
 * failure is only logged) so the caller can fire-and-forget. Spam suppression
 * (hysteresis / no-notify on first evaluation / flapping / mute) is handled by
 * the caller (alerts.ts).
 */
export async function dispatchAlert(entry: AlertEntry): Promise<void> {
  if (channelsFor(entry.level).length === 0) return;

  if (BATCH_MS > 0) {
    queue.push(entry);
    scheduleFlush();
    return;
  }
  await sendNow(entry);
}
