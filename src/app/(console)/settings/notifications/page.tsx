'use client';

import React, { useState } from 'react';
import { MonitorSmartphone, Webhook, type LucideIcon } from 'lucide-react';

import { setMute } from '@/components/alerts/muteApi';
import {
  NOTIFY_URL,
  sendTestNotification,
  updateNotificationSettings,
  type NotificationsInfo
} from '@/components/notifications/notificationsApi';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { useShellActions } from '@/components/shell/ShellActions';
import { PageBody } from '@/components/ui/PageBody';
import { Panel } from '@/components/ui/Panel';
import { Toggle } from '@/components/ui/Toggle';
import { usePolled } from '@/hooks/usePolled';
import { LEVEL_STYLES } from '@/lib/statusColors';
import { cn } from '@/lib/utils';
import type { AlertLevel } from '@/types/system';
import { formatTimestamp } from '@/utils/timeFormat';

// Notification settings: channels (this browser's desktop notifications and
// the server's webhook), which levels they carry, and a quick mute.

const LEVELS: { level: AlertLevel; label: string }[] = [
  { level: 'critical', label: 'Critical' },
  { level: 'warning', label: 'Warning' },
  { level: 'info', label: 'Info' },
  { level: 'ok', label: 'Resolved' }
];
const MUTE_HOURS = [1, 4, 24];

function ChannelRow({
  icon: Icon,
  label,
  detail,
  on,
  onToggle,
  disabled = false,
  disabledReason
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="flex items-center gap-3.5 border-t border-line-soft px-[18px] py-[13px] first:border-t-0">
      <Icon size={16} className="shrink-0 text-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px]">{label}</span>
        <span className="truncate font-mono text-[11.5px] text-subtle">{detail}</span>
      </div>
      <Toggle
        on={on}
        onChange={onToggle}
        label={`Toggle ${label}`}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
      />
    </div>
  );
}

function browserPermitted(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
}

// Shows a desktop notification on this device; false when the browser refuses.
function showBrowserTest(): boolean {
  try {
    new Notification('ServerMonitor · test', { body: 'Browser notifications are working.' });
    return true;
  } catch {
    return false;
  }
}

function permissionText(): string {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'Not supported in this browser';
  if (Notification.permission === 'denied') return 'This device · blocked in browser settings';
  return 'This device';
}

export default function NotificationsPage() {
  const info = usePolled<NotificationsInfo>(NOTIFY_URL, 60_000);
  const { data } = useSystem();
  const { browserNotify } = useShellActions();
  const flash = useToast();
  const [busy, setBusy] = useState(false);

  const settings = info?.settings ?? null;
  const mutedUntil = data?.mute.globalMutedUntil ?? null;

  const update = async (patch: Parameters<typeof updateNotificationSettings>[0], done: string) => {
    const result = await updateNotificationSettings(patch);
    flash(result.ok ? done : (result.error ?? 'Could not save'));
  };

  const webhookOn = Boolean(settings?.webhook && info?.webhookConfigured);
  const browserOn = browserNotify.enabled && browserPermitted();

  // Exercises every enabled channel: a desktop notification here, and the
  // server's webhook(s).
  const test = async () => {
    if (!browserOn && !webhookOn) {
      flash('Enable at least one channel first');
      return;
    }
    let sent = 0;
    let error: string | null = null;
    if (browserOn) {
      if (showBrowserTest()) sent += 1;
      else error = 'The browser blocked the test notification';
    }
    if (webhookOn) {
      setBusy(true);
      const result = await sendTestNotification();
      setBusy(false);
      if (result.ok) sent += 1;
      else error = result.error ?? 'Could not send the webhook test';
    }
    flash(
      error && sent > 0
        ? `Test sent to ${sent} channel${sent === 1 ? '' : 's'} · ${error}`
        : (error ?? `Test sent to ${sent} channel${sent === 1 ? '' : 's'}`)
    );
  };

  const mute = async (hours: number | null) => {
    const ok = await setMute(hours === null ? null : hours * 60);
    flash(
      ok
        ? hours === null
          ? 'Notifications unmuted'
          : `Notifications muted for ${hours}h`
        : 'Could not change mute'
    );
  };

  return (
    <PageBody className="max-w-[900px]">
      <Panel
        title="Channels"
        actions={
          <button
            onClick={() => void test()}
            disabled={busy}
            className="rounded-md bg-accent/14 px-3 py-[5px] text-xs text-info-fg hover:bg-accent/22 disabled:opacity-50"
          >
            Send test
          </button>
        }
      >
        <ChannelRow
          icon={MonitorSmartphone}
          label="Browser push"
          detail={permissionText()}
          on={browserNotify.enabled}
          onToggle={browserNotify.toggle}
        />
        <ChannelRow
          icon={Webhook}
          label="Webhook"
          detail={
            info?.webhookConfigured
              ? 'ALERT_WEBHOOK_URL · per-level overrides apply'
              : 'Not configured (ALERT_WEBHOOK_URL)'
          }
          on={webhookOn}
          disabled={!info?.webhookConfigured}
          disabledReason="Set ALERT_WEBHOOK_URL to enable webhook notifications"
          onToggle={() =>
            settings &&
            void update({ webhook: !settings.webhook }, `Webhook ${settings.webhook ? 'off' : 'on'}`)
          }
        />
      </Panel>

      <Panel title="Levels to notify">
        <div className="flex flex-wrap gap-2 px-[18px] py-3.5">
          {LEVELS.map(({ level, label }) => {
            const on = settings?.levels[level] ?? false;
            return (
              <button
                key={level}
                aria-pressed={on}
                disabled={!settings}
                onClick={() =>
                  settings &&
                  void update(
                    { levels: { ...settings.levels, [level]: !on } },
                    `${label} notifications ${on ? 'off' : 'on'}`
                  )
                }
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12.5px]',
                  on ? 'border-accent/45 bg-accent/10 text-fg' : 'border-line-strong text-subtle'
                )}
              >
                <span
                  className="h-[7px] w-[7px] rounded-full"
                  style={{ background: LEVEL_STYLES[level].dot }}
                />
                {label}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Mute"
        actions={
          <span className={cn('text-[12.5px]', mutedUntil ? 'text-warn-fg' : 'text-dim')}>
            {mutedUntil
              ? `Muted until ${formatTimestamp(new Date(mutedUntil).getTime()).slice(5, 16)}`
              : 'Not muted'}
          </span>
        }
      >
        <div className="flex flex-wrap gap-2 px-[18px] py-3.5">
          {MUTE_HOURS.map(hours => (
            <button
              key={hours}
              onClick={() => void mute(hours)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] text-fg-2 hover:bg-white/5"
            >
              Mute {hours}h
            </button>
          ))}
          {mutedUntil && (
            <button
              onClick={() => void mute(null)}
              className="rounded-md bg-accent/14 px-3 py-1.5 text-[12.5px] text-info-fg"
            >
              Unmute now
            </button>
          )}
        </div>
      </Panel>
    </PageBody>
  );
}
