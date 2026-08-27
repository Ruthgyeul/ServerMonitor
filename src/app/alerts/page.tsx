'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { AlertEntry, AlertLevel } from '@/types/system';

// Alert history view. The dashboard card shows only the most recent alerts and
// scrolls them away; this reads the full persisted log (/api/alerts) with a
// level filter, a text search, and a 48h incident timeline strip (#60).

const LEVELS: AlertLevel[] = ['critical', 'warning', 'info', 'ok'];

const LEVEL_COLOR: Record<AlertLevel, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#60a5fa',
  ok: '#34d399'
};

const WINDOW_MS = 48 * 60 * 60 * 1000;

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<AlertLevel | 'all'>('all');
  const [query, setQuery] = useState('');
  // Set on each load (never during render) so the timeline's "now" edge advances
  // without an impure Date.now() in the render body.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch('/api/alerts')
        .then(response => {
          if (response.status === 401) {
            window.location.href = '/login?next=/alerts';
            return null;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then(data => {
          if (!cancelled && data) {
            setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
            setNow(Date.now());
          }
        })
        .catch(err => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
        });

    load();
    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return alerts.filter(
      alert =>
        (level === 'all' || alert.level === level) &&
        (needle === '' || alert.message.toLowerCase().includes(needle))
    );
  }, [alerts, level, query]);

  return (
    <div className="min-h-screen bg-gray-900 p-4 text-gray-100 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Alert history</h1>
          <Link href="/" className="text-xs text-blue-400 hover:underline">
            ← Dashboard
          </Link>
        </header>

        {/* 48h incident timeline */}
        <Timeline alerts={alerts} now={now} />

        {/* Filters */}
        <div className="mb-4 mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setLevel('all')}
            className={`rounded px-2 py-1 text-xs ${level === 'all' ? 'bg-gray-700' : 'bg-gray-800'}`}
          >
            all
          </button>
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`rounded px-2 py-1 text-xs ${level === l ? 'bg-gray-700' : 'bg-gray-800'}`}
              style={{ color: LEVEL_COLOR[l] }}
            >
              {l}
            </button>
          ))}
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search messages…"
            className="ml-auto w-48 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs outline-none focus:border-blue-500"
          />
        </div>

        {error && <div className="mb-3 text-xs text-red-400">Could not load alerts: {error}</div>}

        <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
          {filtered.length === 0 ? (
            <li className="p-4 text-center text-xs text-gray-500">No alerts match.</li>
          ) : (
            filtered.map(alert => (
              <li key={alert.id} className="flex items-center gap-3 p-3">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: LEVEL_COLOR[alert.level] }}
                  aria-hidden
                />
                <span className="flex-1 text-sm">{alert.message}</span>
                <time className="shrink-0 text-xs text-gray-500" dateTime={alert.at}>
                  {new Date(alert.at).toLocaleString()}
                </time>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

const Timeline: React.FC<{ alerts: AlertEntry[]; now: number }> = ({ alerts, now }) => {
  const start = now - WINDOW_MS;
  const marks = alerts
    .map(alert => ({ alert, t: new Date(alert.at).getTime() }))
    .filter(({ t }) => t >= start && t <= now);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <div className="mb-1 flex justify-between text-[10px] text-gray-500">
        <span>48h ago</span>
        <span>now</span>
      </div>
      <div className="relative h-6 w-full rounded bg-gray-800/60">
        {marks.map(({ alert, t }) => {
          const left = ((t - start) / WINDOW_MS) * 100;
          return (
            <span
              key={alert.id}
              className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-sm"
              style={{ left: `${left}%`, backgroundColor: LEVEL_COLOR[alert.level] }}
              title={`${new Date(alert.at).toLocaleString()} — ${alert.message}`}
            />
          );
        })}
        {marks.length === 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-600">
            no incidents in the last 48h
          </span>
        )}
      </div>
    </div>
  );
};
