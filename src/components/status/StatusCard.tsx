'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Server } from 'lucide-react';

import { usageColor } from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';
import { formatTimestamp } from '@/utils/timeFormat';

// The public status card: overall state plus a handful of sanitised metrics
// from /api/status (no hostnames, IPs or process names). Used by the public
// /status page and by its preview inside the console.

interface Status {
  status: 'operational' | 'degraded';
  activeAlerts: number;
  uptime: { days: number; hours: number; minutes: number };
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  gpu: number | 'N/A' | null;
  ping: number | null;
  loadAvg: number | null;
  timestamp: string;
}

const POLL_MS = 5000;

function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const everSucceeded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as Status;
        if (cancelled) return;
        everSucceeded.current = true;
        setStatus(data);
        setFailed(false);
      } catch {
        // After a first success keep showing it; only a cold failure is an error.
        if (!cancelled && !everSucceeded.current) setFailed(true);
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { status, failed };
}

const percentMetric = (label: string, value: number | null) => ({
  label,
  value: value === null ? '—' : `${value}%`,
  color: value === null ? PALETTE.subtle : usageColor(value, PALETTE.text)
});

export function StatusCard() {
  const { status, failed } = useStatus();

  let dot: string = PALETTE.accent;
  let heading = 'Checking status…';
  let sub = '';
  if (failed) {
    dot = PALETTE.faint;
    heading = 'Status unavailable';
    sub = 'The status endpoint could not be reached.';
  } else if (status) {
    const { days, hours, minutes } = status.uptime;
    dot = status.status === 'operational' ? PALETTE.ok : PALETTE.warn;
    heading = status.status === 'operational' ? 'All systems operational' : 'Degraded performance';
    // The alert count only appears when something is wrong.
    const alerts =
      status.status === 'degraded'
        ? ` · ${status.activeAlerts} active alert${status.activeAlerts === 1 ? '' : 's'}`
        : '';
    sub = `up ${days}d ${hours}h ${minutes}m${alerts}`;
  }

  const metrics = status
    ? [
        percentMetric('CPU', status.cpu),
        percentMetric('Memory', status.memory),
        percentMetric('Disk', status.disk),
        typeof status.gpu === 'number'
          ? percentMetric('GPU', status.gpu)
          : { label: 'GPU', value: status.gpu ?? '—', color: PALETTE.subtle },
        {
          label: 'Ping',
          value: status.ping === null ? '—' : `${status.ping.toFixed(1)}ms`,
          color: PALETTE.text
        },
        {
          label: 'Load avg',
          value: status.loadAvg === null ? '—' : status.loadAvg.toFixed(2),
          color: PALETTE.text
        }
      ]
    : [];

  return (
    <section className="box-border flex w-full max-w-[680px] flex-col gap-[22px] rounded-xl border border-line-strong bg-card p-7">
      <div className="flex items-center gap-2.5">
        <Server size={15} className="text-accent" />
        <span className="text-sm font-semibold">ServerMonitor</span>
        <span className="text-[12.5px] text-subtle">Public status</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
          <span className="text-[22px] font-semibold tracking-[-0.02em]">{heading}</span>
        </div>
        {sub && <span className="font-mono text-xs text-dim">{sub}</span>}
      </div>
      {metrics.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {metrics.map(metric => (
            <div
              key={metric.label}
              className="flex flex-col gap-1 rounded-lg border border-line bg-sidebar p-3.5"
            >
              <span className="text-[11.5px] text-subtle">{metric.label}</span>
              <span className="font-mono text-lg font-medium" style={{ color: metric.color }}>
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      )}
      <span className="font-mono text-[11px] text-faint">
        Refreshes every 5s{status ? ` · ${formatTimestamp(new Date(status.timestamp).getTime())}` : ''}
      </span>
    </section>
  );
}
