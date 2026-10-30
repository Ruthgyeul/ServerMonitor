'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CircleCheck,
  MessageSquare,
  RotateCcw,
  Send,
  TriangleAlert,
  UserCheck,
  type LucideIcon
} from 'lucide-react';

import { actOnIncident } from '@/components/alerts/incidentApi';
import {
  contextChart,
  contextSpec,
  eventAuthor,
  formatSpan,
  formatThreshold,
  incidentDuration,
  INCIDENTS_URL,
  STATUS_STYLE,
  windowUrl
} from '@/components/alerts/incidentView';
import { linePath } from '@/components/charts/paths';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { LevelTag } from '@/components/ui/LevelTag';
import { PageBody } from '@/components/ui/PageBody';
import { Panel } from '@/components/ui/Panel';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { PALETTE } from '@/lib/theme';
import type { MetricWindow } from '@/types/system';
import type { Incident, IncidentAction, IncidentEventKind } from '@/utils/collectors/incidents';
import { formatTimestamp } from '@/utils/timeFormat';

// One incident: summary and actions, its timeline with notes, and the metric
// around the time it fired.

const POLL_MS = 10_000;
const CHART_BOX = { x: 0, y: 5, width: 300, height: 100 };

const EVENT_ICONS: Record<IncidentEventKind, { icon: LucideIcon; color: string }> = {
  trigger: { icon: TriangleAlert, color: PALETTE.crit },
  notify: { icon: Send, color: PALETTE.accent },
  ack: { icon: UserCheck, color: PALETTE.warn },
  note: { icon: MessageSquare, color: PALETTE.text3 },
  resolve: { icon: CircleCheck, color: PALETTE.ok },
  reopen: { icon: RotateCcw, color: PALETTE.warn }
};

const ACTIONS: Record<Incident['status'], { label: string; action: IncidentAction; primary: boolean }[]> = {
  open: [
    { label: 'Acknowledge', action: 'ack', primary: true },
    { label: 'Resolve', action: 'resolve', primary: false }
  ],
  acknowledged: [{ label: 'Resolve', action: 'resolve', primary: true }],
  resolved: [{ label: 'Reopen', action: 'reopen', primary: false }]
};

const DONE: Record<IncidentAction, string> = {
  ack: 'Incident acknowledged',
  note: 'Note added',
  resolve: 'Incident resolved',
  reopen: 'Incident reopened'
};

function MetricContext({ incident, now }: { incident: Incident; now: number }) {
  const { data } = useSystem();
  const spec = contextSpec(incident, now);
  const series = usePolled<MetricWindow>(spec ? windowUrl(spec) : null, 60_000);

  if (!spec) {
    return (
      <p className="px-[18px] py-4 text-[12.5px] text-subtle">
        This rule has no numeric series. Check the service or endpoint logs for detail.
      </p>
    );
  }
  const cores = spec.perCore ? (data?.cpu.cores ?? 1) : 1;
  const chart = series ? contextChart(series, incident, now, cores) : null;
  if (!series) return <p className="px-[18px] py-4 text-[12.5px] text-subtle">Loading…</p>;
  const values = chart?.values.filter((value): value is number => value !== null) ?? [];
  if (!chart || values.length === 0) {
    return (
      <p className="px-[18px] py-4 text-[12.5px] text-subtle">
        No samples were kept for this window — the monitor wasn&apos;t collecting then.
      </p>
    );
  }

  // The stored threshold only draws when it is in the chart's unit (a fill
  // forecast's "24h" doesn't belong on a % axis).
  const stored =
    incident.threshold && incident.threshold.unit === spec.unit ? incident.threshold.value : null;
  const threshold = stored ?? (spec.thresholdKey ? (data?.thresholds[spec.thresholdKey] ?? null) : null);
  const high = Math.max(threshold ?? 0, ...values) * 1.15 || 1;
  const low = Math.max(0, Math.min(threshold ?? Infinity, ...values) * 0.75);
  const toY = (value: number) =>
    CHART_BOX.y + CHART_BOX.height - ((value - low) / (high - low || 1)) * CHART_BOX.height;

  return (
    <div className="flex flex-col gap-2 px-[18px] py-3.5">
      <span className="text-[11.5px] text-subtle">{spec.label} around the incident</span>
      <svg viewBox="0 0 300 110" preserveAspectRatio="none" className="block h-[150px] w-full">
        <rect
          x={chart.spanStart * 300}
          y={0}
          width={Math.max(1, (chart.spanEnd - chart.spanStart) * 300)}
          height={110}
          fill="rgba(239,95,90,0.08)"
        />
        {threshold !== null && (
          <line
            x1={0}
            x2={300}
            y1={toY(threshold)}
            y2={toY(threshold)}
            stroke={PALETTE.crit}
            strokeDasharray="4 4"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={linePath(chart.values, CHART_BOX, high, low)}
          fill="none"
          stroke={PALETTE.accent}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between font-mono text-[10.5px] text-faint">
        <span>before</span>
        {threshold !== null && (
          <span className="text-crit-fg">
            threshold {threshold}
            {spec.unit}
          </span>
        )}
        <span>{incident.resolvedAt ? 'after' : 'now'}</span>
      </div>
    </div>
  );
}

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const url = `${INCIDENTS_URL}/${encodeURIComponent(id)}`;
  const polled = usePolled<Incident>(url, POLL_MS);
  const list = usePolled<{ incidents: Incident[] }>(INCIDENTS_URL, POLL_MS);
  const { data } = useSystem();
  const now = useNow();
  const flash = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // The list answers "missing" quickly when the id is unknown (the single fetch 404s silently).
  const incident = polled ?? list?.incidents.find(candidate => candidate.id === id) ?? null;
  const missing = list !== null && !incident;

  const act = async (action: IncidentAction) => {
    setBusy(true);
    const result = await actOnIncident(id, action, note);
    setBusy(false);
    if (result.ok && action === 'note') setNote('');
    flash(result.ok ? DONE[action] : (result.error ?? 'Request failed'));
  };

  if (now === null) return null;

  return (
    <PageBody className="max-w-[1100px]">
      <Link href="/alerts" className="text-[12.5px] text-muted hover:text-fg">
        ← All alerts
      </Link>
      {missing && <p className="text-[13px] text-muted">This incident no longer exists.</p>}
      {!incident && !missing && <p className="text-[13px] text-subtle">Loading…</p>}
      {incident && (
        <>
          <section className="flex flex-wrap items-start gap-x-6 gap-y-3.5 rounded-[10px] border border-line bg-card px-5 py-[18px]">
            <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <LevelTag level={incident.level} />
                <span
                  className="rounded-full px-[9px] py-0.5 text-[11.5px]"
                  style={{
                    color: STATUS_STYLE[incident.status].fg,
                    background: STATUS_STYLE[incident.status].bg
                  }}
                >
                  {STATUS_STYLE[incident.status].label}
                </span>
              </div>
              <h2 className="text-xl font-semibold tracking-[-0.015em] text-pretty">{incident.title}</h2>
            </div>
            <div className="flex gap-2">
              {ACTIONS[incident.status].map(button => (
                <button
                  key={button.action}
                  disabled={busy}
                  onClick={() => void act(button.action)}
                  className={
                    button.primary
                      ? 'rounded-[7px] bg-accent px-3.5 py-[7px] text-[12.5px] font-medium text-canvas disabled:opacity-60'
                      : 'rounded-[7px] bg-white/6 px-3.5 py-[7px] text-[12.5px] font-medium text-fg-2 hover:bg-white/10 disabled:opacity-60'
                  }
                >
                  {button.label}
                </button>
              ))}
            </div>
            <dl className="grid flex-[1_1_100%] grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-5 gap-y-3 border-t border-white/5 pt-3.5">
              {[
                ['Rule', incident.rule ?? incident.key],
                ['Host', data?.host.hostname ?? '—'],
                ['Started', formatTimestamp(new Date(incident.openedAt).getTime())],
                [
                  'Ended',
                  incident.resolvedAt ? formatTimestamp(new Date(incident.resolvedAt).getTime()) : '—'
                ],
                [
                  'Duration',
                  `${formatSpan(incidentDuration(incident, now))}${incident.resolvedAt ? '' : ' · ongoing'}`
                ],
                ['Threshold', formatThreshold(incident.threshold)]
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-[3px]">
                  <dt className="text-[11.5px] text-subtle">{label}</dt>
                  <dd className="font-mono text-[12.5px] text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="flex flex-wrap items-start gap-4">
            <Panel className="min-w-0 flex-[3_1_420px]" title="Timeline">
              <ol className="m-0 list-none px-[18px] pt-2 pb-1">
                {incident.events.map((event, index) => {
                  const { icon: Icon, color } = EVENT_ICONS[event.kind];
                  return (
                    <li
                      key={`${event.at}-${index}`}
                      className="grid grid-cols-[28px_1fr] gap-3 border-b border-line-soft py-2.5"
                    >
                      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-track">
                        <Icon size={13} style={{ color }} />
                      </span>
                      <div className="flex min-w-0 flex-col gap-[3px]">
                        <span className="text-[13px] leading-[1.45] text-pretty text-fg">{event.text}</span>
                        <span className="font-mono text-[11px] text-subtle">
                          {eventAuthor(event)} · {formatTimestamp(new Date(event.at).getTime())}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-col gap-2 px-[18px] py-3.5">
                <textarea
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder="Add a note: what you checked, what you changed…"
                  rows={3}
                  maxLength={500}
                  aria-label="Note"
                  className="resize-y rounded-[7px] border border-line-strong bg-sidebar px-[11px] py-[9px] text-[12.5px] text-fg outline-none focus:border-accent"
                />
                <button
                  disabled={busy || note.trim() === ''}
                  onClick={() => void act('note')}
                  className="self-end rounded-md bg-white/8 px-3.5 py-1.5 text-[12.5px] text-fg hover:bg-white/12 disabled:opacity-50"
                >
                  Add note
                </button>
              </div>
            </Panel>
            <Panel className="min-w-0 flex-[2_1_300px]" title="Metric context">
              <MetricContext incident={incident} now={now} />
            </Panel>
          </div>
        </>
      )}
    </PageBody>
  );
}
