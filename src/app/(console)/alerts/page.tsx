'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';

import { ClipboardList } from 'lucide-react';

import { AlertTimeline } from '@/components/alerts/AlertTimeline';
import {
  formatSpan,
  incidentDuration,
  incidentByKey,
  INCIDENTS_URL,
  STATUS_STYLE
} from '@/components/alerts/incidentView';
import { setMute } from '@/components/alerts/muteApi';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { LevelTag } from '@/components/ui/LevelTag';
import { PageBody } from '@/components/ui/PageBody';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { LEVEL_STYLES } from '@/lib/statusColors';
import { cn } from '@/lib/utils';
import type { AlertEntry, AlertLevel } from '@/types/system';
import type { Incident } from '@/utils/collectors/incidents';
import { formatAge, formatTimestamp } from '@/utils/timeFormat';

// Alert history: what is waiting to fire or resolve, what is firing now, the
// incidents those opened, a 48h timeline, and the full persisted log
// (/api/alerts) with a level filter and text search.

const LOG_URL = '/api/alerts';
const LOG_POLL_MS = 10_000;
const INCIDENT_COLUMNS = 'grid grid-cols-[110px_minmax(0,1fr)_54px_100px_110px] gap-3';

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
  const incidentList = usePolled<{ incidents: Incident[] }>(INCIDENTS_URL, LOG_POLL_MS)?.incidents ?? null;
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
  const waiting = data.pendingAlerts;
  const fireDelay = data.alertTiming.fireDelaySec;
  const incidentsShown = incidentList ?? [];
  const incidentFor = incidentByKey(incidentsShown);
  const openCount = incidentsShown.filter(incident => incident.status !== 'resolved').length;

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
      {waiting.length > 0 && (
        <section className="rounded-[10px] border border-warn/30 bg-card">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-white/5 px-[18px] py-3.5">
            <h2 className="flex-1 text-[13.5px] font-medium">Pending &amp; recovering</h2>
            <span className="text-xs text-dim">
              Threshold rules fire after {fireDelay ? `${fireDelay}s` : 'immediately'}
            </span>
            <Link href="/settings/rules#timing" className="text-xs">
              Alert timing
            </Link>
          </div>
          {waiting.map(alert => {
            const left = Math.max(0, Math.ceil((new Date(alert.dueAt).getTime() - now) / 1000));
            const pendingRow = alert.state === 'pending';
            return (
              <div
                key={`${alert.state}-${alert.key}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-line-soft px-[18px] py-[11px] first:border-t-0"
              >
                <span
                  className={cn(
                    'rounded-[3px] px-1.5 py-px font-mono text-[10px]',
                    pendingRow ? 'bg-warn/12 text-warn-fg' : 'bg-ok/10 text-ok-fg'
                  )}
                >
                  {pendingRow ? 'PEND' : 'RECOV'}
                </span>
                <span className="text-[13px] text-fg">{alert.short ?? alert.message}</span>
                <span className="font-mono text-[11.5px] text-fg-3">
                  {pendingRow ? `fires in ${left}s` : `resolves in ${left}s`}
                </span>
              </div>
            );
          })}
        </section>
      )}

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
          active.map(alert => {
            const incident = incidentFor.get(alert.key);
            const row = (
              <>
                <LevelTag level={alert.level} />
                <span className="text-[13px] text-fg">{alert.message}</span>
                <span className="font-mono text-[11px] text-subtle">
                  {alert.ruleText ?? alert.rule ?? alert.key}
                </span>
                <span className="text-xs text-link">{incident ? 'Incident →' : ''}</span>
              </>
            );
            const rowClass =
              'grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-t border-line-soft px-[18px] py-[11px] text-inherit first:border-t-0';
            return incident ? (
              <Link
                key={alert.key}
                href={`/alerts/incidents/${incident.id}`}
                className={cn(rowClass, 'hover:bg-white/3 hover:text-inherit')}
              >
                {row}
              </Link>
            ) : (
              <div key={alert.key} className={rowClass}>
                {row}
              </div>
            );
          })
        )}
      </section>

      <section className="overflow-hidden rounded-[10px] border border-line bg-card">
        <div className="flex items-center gap-3 border-b border-white/5 px-[18px] py-3.5">
          <h2 className="flex-1 text-[13.5px] font-medium">Incidents</h2>
          <span className="font-mono text-[11.5px] text-subtle">{openCount} open</span>
        </div>
        {incidentList !== null && incidentsShown.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No incidents"
            body="An incident opens automatically when an alert fires, with its own timeline and notes."
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className={`${INCIDENT_COLUMNS} px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint`}>
                <span>Status</span>
                <span>Incident</span>
                <span>Level</span>
                <span>Started</span>
                <span className="text-right">Duration</span>
              </div>
              {incidentsShown.map(incident => {
                const status = STATUS_STYLE[incident.status];
                const age = formatAge(now - new Date(incident.openedAt).getTime());
                return (
                  <Link
                    key={incident.id}
                    href={`/alerts/incidents/${incident.id}`}
                    className={`${INCIDENT_COLUMNS} items-center border-t border-line-soft px-[18px] py-2.5 text-inherit hover:bg-white/3 hover:text-inherit`}
                  >
                    <span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{ color: status.fg, background: status.bg }}
                      >
                        {status.label}
                      </span>
                    </span>
                    <span className="truncate text-[12.5px] text-fg">{incident.title}</span>
                    <span className="justify-self-start">
                      <LevelTag level={incident.level} />
                    </span>
                    <span className="font-mono text-[11.5px] text-muted">
                      {age === 'now' ? 'just now' : `${age} ago`}
                    </span>
                    <span className="text-right font-mono text-[11.5px] text-muted">
                      {formatSpan(incidentDuration(incident, now))}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
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
