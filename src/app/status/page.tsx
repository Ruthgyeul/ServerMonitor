'use client';

import React, { useEffect, useState } from 'react';

// Public status page (#64). Renders the sanitised /api/status summary — an
// uptime-style page safe to share externally. No reconnaissance data ever
// reaches here; see src/app/api/status/route.ts.

interface Status {
  status: 'operational' | 'degraded';
  activeAlerts: number;
  uptime: { days: number; hours: number; minutes: number };
  cpu: number;
  memory: number;
  disk: number;
  load1: number | null;
  timestamp: string;
}

export default function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch('/api/status', { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : Promise.reject()))
        .then(data => !cancelled && setStatus(data))
        .catch(() => !cancelled && setError(true));
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const ok = status?.status === 'operational';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-900 p-6 text-gray-100">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-4 w-4 rounded-full"
          style={{ backgroundColor: error ? '#6b7280' : ok ? '#34d399' : '#f59e0b' }}
          aria-hidden
        />
        <h1 className="text-xl font-semibold">
          {error ? 'Status unavailable' : ok ? 'All systems operational' : 'Degraded performance'}
        </h1>
        {status && !error && (
          <p className="text-xs text-gray-400">
            up {status.uptime.days}d {status.uptime.hours}h {status.uptime.minutes}m
            {status.activeAlerts > 0 && ` · ${status.activeAlerts} active alert(s)`}
          </p>
        )}
      </div>

      {status && !error && (
        <div className="grid w-full max-w-md grid-cols-3 gap-3">
          <Metric label="CPU" value={`${status.cpu}%`} />
          <Metric label="Memory" value={`${status.memory}%`} />
          <Metric label="Disk" value={`${status.disk}%`} />
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
