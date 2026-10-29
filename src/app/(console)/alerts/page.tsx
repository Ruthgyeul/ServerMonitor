'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';

import { AlertTimeline } from '@/components/alerts/AlertTimeline';
import { setMute } from '@/components/alerts/muteApi';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { LevelTag } from '@/components/ui/LevelTag';
import { PageBody } from '@/components/ui/PageBody';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { LEVEL_STYLES } from '@/lib/statusColors';
import { cn } from '@/lib/utils';
import type { AlertEntry, AlertLevel } from '@/types/system';
import { formatTimestamp } from '@/utils/timeFormat';

// Alert history: what is firing now, a 48h timeline, and the full persisted
// log (/api/alerts) with a level filter and text search.

const LOG_URL = '/api/alerts';
const LOG_POLL_MS = 10_000;

type Filter = 'all' | AlertLevel;

const CHIPS: { value: Filter; label: string; dot: string }[] = [
  { value: 'all', label: 'All', dot: 'var(--color-dim)' },
  { value: 'critical', label: 'Critical', dot: LEVEL_STYLES.critical.dot },
  { value: 'warning', label: 'Warning', dot: LEVEL_STYLES.warning.dot },
  { value: 'info', label: 'Info', dot: LEVEL_STYLES.info.dot },
  { value: 'ok', label: 'Resolved', dot: LEVEL_STYLES.ok.dot }
];

export default function AlertsPage() {
  const { data } = useSystem();
  const now = useNow();
  const flash = useToast();
  const log = usePolled<{ alerts: AlertEntry[] }>(LOG_URL, LOG_POLL_MS, false)?.alerts ?? null;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const entries = useMemo(() => log ?? data?.alerts ?? [], [log, data?.alerts]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: entries.length, critical: 0, warning: 0, info: 0, ok: 0 };
    for (const entry of entries) result[entry.level] += 1;
    return result;
  }, [entries]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(
      entry =>
        (filter === 'all' || entry.level === filter) &&
        (!needle || entry.message.toLowerCase().includes(needle))
    );
  }, [entries, filter, query]);

  if (!data || now === null) return null;
  const active = data.activeAlerts;
  const muted = data.mute.globalMutedUntil !== null;

  const mute = async (minutes: number | null) => {
    const ok = await setMute(minutes);
    flash(
      ok
        ? minutes === null
          ? 'Notifications unmuted'
          : 'Notifications muted for 1h'
        : 'Could not change mute'
    );
  };

  return (
    <PageBody className="max-w-[1100px]">
      <section
        className={cn('rounded-[10px] border bg-card', active.length > 0 ? 'border-crit/30' : 'border-line')}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-white/5 px-[18px] py-3.5">
          <h2 className="flex-1 text-[13.5px] font-medium">Active alerts</h2>
          <Link href="/settings/rules" className="text-xs">
            Edit thresholds
          </Link>
          {muted ? (
            <button onClick={() => void mute(null)} className="text-xs text-link">
              Unmute
            </button>
          ) : (
            <button onClick={() => void mute(60)} className="text-xs text-fg-3 hover:text-fg">
              Mute 1h
            </button>
          )}
        </div>
        {active.length === 0 ? (
          <p className="px-[18px] py-4 text-[12.5px] text-dim">
            No rules are firing. All metrics are within their thresholds.
          </p>
        ) : (
          active.map(alert => (
            <div
              key={alert.key}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-line-soft px-[18px] py-[11px] first:border-t-0"
            >
              <LevelTag level={alert.level} />
              <span className="text-[13px] text-fg">{alert.message}</span>
              <span className="font-mono text-[11px] text-subtle">
                {alert.key} · since {formatTimestamp(new Date(alert.since).getTime()).slice(5, 16)}
              </span>
            </div>
          ))
        )}
      </section>

      <AlertTimeline alerts={entries} now={now} />

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map(chip => (
          <button
            key={chip.value}
            onClick={() => setFilter(chip.value)}
            aria-pressed={filter === chip.value}
            className={cn(
              'flex items-center gap-[7px] rounded-md border px-[11px] py-[5px] text-xs text-fg-2',
              filter === chip.value ? 'border-white/20 bg-track' : 'border-line'
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: chip.dot }} />
            {chip.label}
            <span className="font-mono text-[11px] text-subtle">{counts[chip.value]}</span>
          </button>
        ))}
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search messages…"
          aria-label="Search alert messages"
          className="ml-auto w-60 max-w-full rounded-[7px] border border-line-strong bg-sidebar px-2.5 py-[7px] text-[12.5px] outline-none focus:border-accent"
        />
      </div>

      <section className="overflow-hidden rounded-[10px] border border-line bg-card">
        {filtered.length === 0 ? (
          <p className="px-[18px] py-5 text-center text-[12.5px] text-subtle">No alerts match.</p>
        ) : (
          filtered.map(entry => (
            <div
              key={entry.id}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line-soft px-[18px] py-[11px]"
            >
              <span className="min-w-[34px] text-center">
                <LevelTag level={entry.level} />
              </span>
              <span className="text-[12.5px] text-fg-2">{entry.message}</span>
              <span className="font-mono text-[11.5px] whitespace-nowrap text-subtle">
                {formatTimestamp(new Date(entry.at).getTime())}
              </span>
            </div>
          ))
        )}
      </section>
    </PageBody>
  );
}
