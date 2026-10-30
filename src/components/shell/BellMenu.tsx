'use client';

import React from 'react';
import Link from 'next/link';

import { Toggle } from '@/components/ui/Toggle';
import { LevelTag } from '@/components/ui/LevelTag';
import { cn } from '@/lib/utils';
import type { AlertEntry, AlertLevel } from '@/types/system';
import { formatAge } from '@/utils/timeFormat';

// Dropdown under the header bell: the latest alert-log entries for the chosen
// levels, plus the per-browser sound/desktop-notification switch.

const BELL_ITEMS = 6;

interface BellMenuProps {
  alerts: AlertEntry[];
  // The notification settings' level filter (Notifications page).
  levels: Record<AlertLevel, boolean>;
  now: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onClose: () => void;
}

export function BellMenu({ alerts, levels, now, soundEnabled, onToggleSound, onClose }: BellMenuProps) {
  const items = alerts.filter(alert => levels[alert.level]).slice(0, BELL_ITEMS);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[29]" />
      <div
        className={cn(
          'z-30 overflow-hidden rounded-[10px] border border-white/10 bg-raised shadow-[0_16px_40px_rgba(0,0,0,0.5)]',
          'fixed top-16 right-3 left-3 desk:absolute desk:top-10 desk:right-0 desk:left-auto desk:w-[360px]',
          'max-w-[calc(100vw-24px)]'
        )}
      >
        <div className="flex items-center border-b border-line px-4 py-3">
          <span className="flex-1 text-[13px] font-medium">Notifications</span>
          <Link href="/settings/notifications" onClick={onClose} className="text-xs">
            Settings
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-5 text-center text-[12.5px] text-subtle">Nothing for the selected levels.</p>
        ) : (
          <ul>
            {items.map(alert => {
              return (
                <li
                  key={alert.id}
                  className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 border-b border-line-soft px-4 py-2.5"
                >
                  <LevelTag level={alert.level} />
                  <span className="text-[12.5px] leading-[1.4] text-fg-2">{alert.message}</span>
                  <span className="font-mono text-[11px] text-faint">
                    {formatAge(now - new Date(alert.at).getTime())}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5">
          <span className="flex-1 text-xs text-muted">Sound &amp; desktop alert on new critical</span>
          <Toggle on={soundEnabled} onChange={onToggleSound} label="Sound and desktop alerts" />
        </div>
        <Link href="/alerts" onClick={onClose} className="block px-4 py-[11px] text-center text-[12.5px]">
          View alert history
        </Link>
      </div>
    </>
  );
}
