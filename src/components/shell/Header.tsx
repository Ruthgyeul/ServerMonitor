'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, BellOff, Download, Menu, Tv } from 'lucide-react';

import { BellMenu } from '@/components/shell/BellMenu';
import type { PageMeta } from '@/components/shell/navigation';
import { cn } from '@/lib/utils';
import type { AlertEntry, MuteState } from '@/types/system';
import { formatHourMinute, formatTimestamp } from '@/utils/timeFormat';

// Sticky page header: breadcrumb + title, connection state, clock and the
// action buttons (kiosk, bell, page actions).

// live: samples arriving · connecting: first sample pending · reconnecting:
// showing a frozen sample · down: never got a sample and the stream is failing.
export type LinkState = 'live' | 'connecting' | 'reconnecting' | 'down';

const iconButton =
  'flex h-8 items-center gap-[7px] rounded-[7px] border border-line-strong text-[12.5px] text-fg-3 hover:bg-white/5 hover:text-fg';

interface HeaderProps {
  meta: PageMeta;
  now: number | null;
  link: LinkState;
  // Seconds since the last sample, shown while reconnecting.
  staleSeconds: number;
  mute: MuteState | null;
  alerts: AlertEntry[];
  activeCount: number;
  bellOpen: boolean;
  onToggleBell: () => void;
  onCloseBell: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenNav: () => void;
  // Overview-only: download a JSON snapshot. Hidden when absent.
  onExport?: () => void;
}

function muteLabel(mute: MuteState | null): string | null {
  if (!mute) return null;
  if (mute.globalMutedUntil)
    return `Muted until ${formatHourMinute(new Date(mute.globalMutedUntil).getTime())}`;
  if (mute.quietNow) return 'Quiet hours';
  return null;
}

export function Header(props: HeaderProps) {
  const { meta, now, link, staleSeconds, mute, activeCount, bellOpen } = props;
  const muted = muteLabel(mute);
  // Muting silences the bell badge as well as the webhook.
  const bellCount = muted ? 0 : activeCount;

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line bg-canvas/92 px-4 py-3.5 backdrop-blur-[10px] desk:px-7">
      <button
        onClick={props.onOpenNav}
        aria-label="Open navigation"
        className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-fg-2 hover:bg-white/5 desk:hidden"
      >
        <Menu size={18} />
      </button>

      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs text-subtle">
          <span>{meta.section}</span>
          <span className="text-divider">/</span>
          <span className="text-fg-3">{meta.item}</span>
        </div>
        <h1 className="text-lg font-semibold tracking-[-0.015em]">{meta.title}</h1>
      </div>

      {muted && (
        <span className="flex items-center gap-[7px] rounded-full border border-warn/30 bg-warn/8 px-2.5 py-[5px] text-xs text-warn-fg">
          <BellOff size={13} />
          {muted}
        </span>
      )}

      <LinkPill link={link} staleSeconds={staleSeconds} />

      <span className="hidden font-mono text-[12.5px] whitespace-nowrap text-fg-3 desk:inline">
        {now === null ? '' : formatTimestamp(now)}
      </span>

      <div className="relative flex gap-1.5">
        <Link
          href="/monitor"
          title="Kiosk mode: full-screen wall display with auto-rotation"
          className={cn(iconButton, 'px-3')}
        >
          <Tv size={14} />
          <span className="hidden desk:inline">Kiosk</span>
        </Link>
        <button
          onClick={props.onToggleBell}
          title="Notifications"
          aria-label="Notifications"
          aria-expanded={bellOpen}
          className={cn(iconButton, 'relative w-8 justify-center', bellOpen && 'bg-white/6')}
        >
          <Bell size={15} />
          {bellCount > 0 && (
            <span className="absolute -top-[5px] -right-[5px] box-border flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 font-mono text-[10px] text-white">
              {bellCount}
            </span>
          )}
        </button>
        {props.onExport && (
          <button
            onClick={props.onExport}
            title="Download a JSON snapshot of current metrics"
            className={cn(iconButton, 'px-3')}
          >
            <Download size={14} />
            <span className="hidden desk:inline">Export</span>
          </button>
        )}
        {bellOpen && now !== null && (
          <BellMenu
            alerts={props.alerts}
            now={now}
            soundEnabled={props.soundEnabled}
            onToggleSound={props.onToggleSound}
            onClose={props.onCloseBell}
          />
        )}
      </div>
    </header>
  );
}

function LinkPill({ link, staleSeconds }: { link: LinkState; staleSeconds: number }) {
  if (link === 'live') {
    return (
      <div className="flex items-center gap-[7px] rounded-full border border-ok/25 bg-ok/7 px-2.5 py-[5px]">
        <span className="h-1.5 w-1.5 animate-live rounded-full bg-ok" />
        <span className="text-xs text-ok-fg">Live</span>
        <span className="font-mono text-[11px] text-subtle">1s stream</span>
      </div>
    );
  }
  if (link === 'connecting') {
    return (
      <div className="flex items-center gap-[7px] rounded-full border border-line-strong px-2.5 py-[5px]">
        <span className="h-1.5 w-1.5 animate-live rounded-full bg-subtle" />
        <span className="text-xs text-fg-3">Connecting…</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-[7px] rounded-full border border-crit/35 bg-crit/8 px-2.5 py-[5px]">
      <span className="h-1.5 w-1.5 animate-alarm rounded-full bg-crit" />
      <span className="text-xs text-crit-fg">Reconnecting…</span>
      <span className="font-mono text-[11px] text-subtle">
        {link === 'down' ? 'no data yet' : `last data ${staleSeconds}s ago`}
      </span>
    </div>
  );
}
