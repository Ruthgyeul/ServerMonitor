'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { TerminalHeaderBar, TerminalTitleBar } from '@/components/common/TerminalWindow';

// Lets an operator tune alert thresholds without editing .env and restarting
// the process — POST/DELETE /api/alerts/config write to a runtime override
// store that alerts.ts's rule evaluation reads fresh on every tick.

interface Threshold {
  key: string;
  label: string;
  default: number;
  envValue: number | null;
  override: number | null;
  value: number;
}

export default function AlertSettingsPage() {
  const [thresholds, setThresholds] = useState<Threshold[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/alerts/config', { cache: 'no-store' })
      .then(response => {
        if (response.status === 401) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = '/login?next=/alerts/settings';
          return null;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!data) return;
        const list = Array.isArray(data.thresholds) ? (data.thresholds as Threshold[]) : [];
        setThresholds(list);
        setDrafts(Object.fromEntries(list.map(t => [t.key, String(t.value)])));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (key: string) => {
      const raw = drafts[key];
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError('Value must be a non-negative number');
        return;
      }
      setSavingKey(key);
      setError(null);
      try {
        const response = await fetch('/api/alerts/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value })
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
        const list = Array.isArray(data.thresholds) ? (data.thresholds as Threshold[]) : [];
        setThresholds(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setSavingKey(null);
      }
    },
    [drafts]
  );

  const reset = useCallback(async (key: string) => {
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch('/api/alerts/config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const list = Array.isArray(data.thresholds) ? (data.thresholds as Threshold[]) : [];
      setThresholds(list);
      setDrafts(prev => {
        const found = list.find(t => t.key === key);
        return found ? { ...prev, [key]: String(found.value) } : prev;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setSavingKey(null);
    }
  }, []);

  return (
    <div className="terminal-bg min-h-screen text-gray-100">
      <TerminalTitleBar path="~/monitor/alerts/settings" />
      <TerminalHeaderBar
        title="Alert thresholds"
        right={
          <Link href="/alerts" className="t-label text-gray-400 transition-colors hover:text-gray-200">
            ← Alert history
          </Link>
        }
      />

      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <p className="t-body mb-4 text-gray-400">
          Changes here apply immediately, on the next collection tick — no restart needed. A value stays
          overridden until you reset it back to the environment default.
        </p>

        {error && <div className="t-label mb-3 text-red-400">{error}</div>}

        {thresholds === null ? (
          <p className="t-body text-gray-500">Loading…</p>
        ) : (
          <ul className="divide-y divide-gray-700 rounded-lg border border-gray-700 bg-gray-800">
            {thresholds.map(threshold => (
              <li key={threshold.key} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="t-body flex items-center gap-2">
                    <span className="truncate">{threshold.label}</span>
                    {threshold.override !== null && (
                      <span className="t-micro shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-400">
                        overridden
                      </span>
                    )}
                  </div>
                  <p className="t-micro text-gray-500">
                    default {threshold.default}
                    {threshold.envValue !== null ? ` · env ${threshold.envValue}` : ''}
                  </p>
                </div>
                <input
                  type="number"
                  value={drafts[threshold.key] ?? String(threshold.value)}
                  onChange={event => setDrafts(prev => ({ ...prev, [threshold.key]: event.target.value }))}
                  className="t-body w-24 rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono outline-none transition-colors focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8]/40"
                  disabled={savingKey === threshold.key}
                />
                <button
                  onClick={() => save(threshold.key)}
                  disabled={savingKey === threshold.key}
                  className="t-label shrink-0 rounded bg-sky-500/20 px-2 py-1 text-sky-400 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
                >
                  Save
                </button>
                {threshold.override !== null && (
                  <button
                    onClick={() => reset(threshold.key)}
                    disabled={savingKey === threshold.key}
                    className="t-label shrink-0 rounded bg-gray-700 px-2 py-1 text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-50"
                  >
                    Reset
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
