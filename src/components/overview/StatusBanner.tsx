'use client';

import React from 'react';
import Link from 'next/link';
import { CircleCheck, TriangleAlert } from 'lucide-react';

import { useToast } from '@/components/providers/ToastProvider';
import type { DashboardData } from '@/utils/dashboardData';
import { formatHourMinute, formatShortStamp } from '@/utils/timeFormat';

// One-line state of the host above the overview panels: active alerts (with a
// quick mute), muted alerts, or "all systems normal" with key facts.

async function setMute(minutes: number | null): Promise<boolean> {
  try {
    const response = await fetch('/api/alerts/mute', {
      method: minutes === null ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: minutes === null ? undefined : JSON.stringify({ minutes })
    });
    return response.ok;
  } catch {
    return false;
  }
}

const bar = 'flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-lg border px-4 py-[11px]';

export function StatusBanner({ data }: { data: DashboardData }) {
  const flash = useToast();
  const active = data.activeAlerts;
  const mutedUntil = data.mute.globalMutedUntil;
  const label = `${active.length} active alert${active.length === 1 ? '' : 's'}`;

  const mute = async (minutes: number | null) => {
    const ok = await setMute(minutes);
    flash(
      ok
        ? minutes === null
          ? 'Notifications unmuted'
          : `Notifications muted for ${minutes / 60}h`
        : 'Could not change mute'
    );
  };

  if (active.length > 0 && mutedUntil) {
    return (
      <div className={`${bar} border-warn/30 bg-warn/6`}>
        <span className="text-[13px] font-medium text-warn-fg">
          {label} · notifications muted until {formatHourMinute(new Date(mutedUntil).getTime())}
        </span>
        <button onClick={() => void mute(null)} className="ml-auto text-[12.5px] text-link">
          Unmute
        </button>
      </div>
    );
  }

  if (active.length > 0) {
    return (
      <div className={`${bar} border-crit/35 bg-crit/8`}>
        <div className="flex items-center gap-[9px]">
          <TriangleAlert size={15} className="text-crit" />
          <span className="text-[13px] font-medium text-crit-fg">{label}</span>
        </div>
        {active.map(alert => (
          <span key={alert.key} className="font-mono text-xs text-fg">
            {alert.message}
          </span>
        ))}
        <div className="ml-auto flex gap-4">
          <button onClick={() => void mute(60)} className="text-[12.5px] text-fg-3 hover:text-fg">
            Mute 1h
          </button>
          <Link href="/alerts" className="text-[12.5px]">
            Open alerts →
          </Link>
        </div>
      </div>
    );
  }

  const { days, hours, minutes } = data.uptime;
  return (
    <div className={`${bar} gap-x-6 border-line bg-card`}>
      <div className="flex items-center gap-[9px]">
        <CircleCheck size={15} className="text-ok" />
        <span className="text-[13px] font-medium">All systems normal</span>
      </div>
      <span className="text-[12.5px] text-dim">0 active alerts</span>
      <span className="text-[12.5px] text-dim">{data.services.failed ?? 0} failed units</span>
      <span className="text-[12.5px] text-dim">
        Uptime <span className="font-mono text-fg-2">{`${days}d ${hours}h ${minutes}m`}</span>
      </span>
      <span className="text-[12.5px] text-dim">
        Last reboot{' '}
        <span className="font-mono text-fg-2">
          {formatShortStamp(new Date(data.host.bootTime).getTime())}
        </span>
      </span>
    </div>
  );
}
