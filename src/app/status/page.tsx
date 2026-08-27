'use client';

import React, { useEffect, useRef, useState } from 'react';

// Public status page (#64). Renders the sanitised /api/status summary — an
// uptime-style page safe to share externally. No reconnaissance data ever
// reaches here; see src/app/api/status/route.ts.

interface Status {
  status: 'operational' | 'degraded';
  activeAlerts: number;
  uptime: { days: number; hours: number; minutes: number };
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  timestamp: string;
}

type Phase = 'loading' | 'ok' | 'error';

export default function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const everSucceeded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // Recursive poll: the next request is scheduled only after the current one
    // settles, so a slow cold-start collection can't pile up overlapping fetches
    // or let an out-of-order response overwrite a newer one.
    const poll = async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as Status;
        if (cancelled) return;
        everSucceeded.current = true;
        setStatus(data);
        setPhase('ok'); // clear any earlier transient error once we recover
      } catch {
        // Keep showing the last good value on a transient failure; only surface
        // an error state if we've never had a successful response.
        if (!cancelled && !everSucceeded.current) setPhase('error');
      } finally {
        if (!cancelled) timer = setTimeout(poll, 5000);
      }
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const dotColor =
    phase === 'error'
      ? '#6b7280'
      : phase === 'loading'
        ? '#60a5fa'
        : status?.status === 'operational'
          ? '#34d399'
          : '#f59e0b';
  const heading =
    phase === 'error'
      ? 'Status unavailable'
      : phase === 'loading'
        ? 'Checking status…'
        : status?.status === 'operational'
          ? 'All systems operational'
          : 'Degraded performance';

  const fmt = (value: number | null) => (value === null ? '—' : `${value}%`);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-900 p-6 text-gray-100">
      <div className="flex flex-col items-center gap-3">
        <div
          className={phase === 'loading' ? 'h-4 w-4 animate-pulse rounded-full' : 'h-4 w-4 rounded-full'}
          style={{ backgroundColor: dotColor }}
          aria-hidden
        />
        <h1 className="text-xl font-semibold">{heading}</h1>
        {status && phase === 'ok' && (
          <p className="text-xs text-gray-400">
            up {status.uptime.days}d {status.uptime.hours}h {status.uptime.minutes}m
            {status.activeAlerts > 0 && ` · ${status.activeAlerts} active alert(s)`}
          </p>
        )}
      </div>

      {status && phase === 'ok' && (
        <div className="grid w-full max-w-md grid-cols-3 gap-3">
          <Metric label="CPU" value={fmt(status.cpu)} />
          <Metric label="Memory" value={fmt(status.memory)} />
          <Metric label="Disk" value={fmt(status.disk)} />
        </div>
      )}
    </div>
  );
}

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-center">
    <div className="text-lg font-bold">{value}</div>
    <div className="text-[11px] text-gray-500">{label}</div>
  </div>
);
