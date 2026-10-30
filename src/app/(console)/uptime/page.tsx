'use client';

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { useToast } from '@/components/providers/ToastProvider';
import { PageBody } from '@/components/ui/PageBody';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import {
  addCheck,
  checkNow,
  removeCheck,
  setPaused,
  UPTIME_URL,
  type UptimeList
} from '@/components/uptime/uptimeApi';
import {
  checkView,
  expectLabel,
  expectSummary,
  intervalLabel,
  isProbeUrl,
  summarize,
  URL_ERROR
} from '@/components/uptime/uptimeView';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { UptimeCheck, UptimeExpect } from '@/types/system';

// HTTP uptime checks: summary cards, an add form and one row per endpoint with
// its last 60 results. Probing happens server-side; this page only polls.

const POLL_MS = 5_000;
const INTERVAL_OPTIONS = [
  { value: 10, label: '10s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
  { value: 300, label: '5m' }
] as const;
const EXPECT_OPTIONS: { value: UptimeExpect; label: string }[] = [
  { value: '200', label: '200' },
  { value: '2xx', label: '2xx' }
];

const INPUT =
  'rounded-[7px] border border-line-strong bg-sidebar px-2.5 py-[7px] text-[12.5px] outline-none focus:border-accent';
const ROW_BUTTON =
  'rounded-[5px] border border-line-strong px-2.5 py-1 text-[11.5px] text-fg-2 hover:bg-white/5 disabled:opacity-50';

function AddCheckForm() {
  const flash = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [intervalSec, setIntervalSec] = useState<number>(30);
  const [expect, setExpect] = useState<UptimeExpect>('200');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isProbeUrl(url)) {
      setError(URL_ERROR);
      return;
    }
    setBusy(true);
    const result = await addCheck({ name, url, intervalSec, expect });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not add check');
      return;
    }
    setName('');
    setUrl('');
    setError(null);
    flash(`${result.data.name} added`);
  };

  return (
    <Panel title="Add check">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 px-[18px] py-3.5">
        <label className="flex flex-[1_1_160px] flex-col gap-1.5 text-[11.5px] text-subtle">
          Name
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="API"
            className={INPUT}
          />
        </label>
        <label className="flex flex-[3_1_280px] flex-col gap-1.5 text-[11.5px] text-subtle">
          URL
          <input
            value={url}
            onChange={event => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder="https://example.com/health"
            className={cn(INPUT, 'font-mono')}
          />
        </label>
        <div className="flex flex-col gap-1.5 text-[11.5px] text-subtle">
          Interval
          <Segmented
            options={INTERVAL_OPTIONS}
            value={intervalSec}
            onChange={setIntervalSec}
            label="Interval"
          />
        </div>
        <div className="flex flex-col gap-1.5 text-[11.5px] text-subtle">
          Expect
          <Segmented options={EXPECT_OPTIONS} value={expect} onChange={setExpect} label="Expected status" />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="h-[33px] rounded-[7px] bg-accent px-4 text-[12.5px] font-medium text-canvas disabled:opacity-60"
        >
          Add check
        </button>
      </form>
      {error && <p className="px-[18px] pb-3.5 text-xs text-crit-fg">{error}</p>}
    </Panel>
  );
}

function CheckRow({ check, now }: { check: UptimeCheck; now: number }) {
  const flash = useToast();
  const [busy, setBusy] = useState(false);
  const view = checkView(check, now);
  const dot = check.paused ? PALETTE.faint : view.down ? PALETTE.crit : PALETTE.ok;

  const act = async (run: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    flash(result.ok ? done : (result.error ?? 'Request failed'));
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-[22px] gap-y-3 border-t border-line-soft px-[18px] py-3.5',
        view.down && 'bg-crit/6'
      )}
    >
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
          <span className="text-[13px] font-medium">{check.name}</span>
          <span
            className={cn(
              'rounded-[3px] px-1.5 py-px font-mono text-[10.5px]',
              view.codeOk ? 'bg-ok/10 text-ok-fg' : 'bg-crit/14 text-crit-fg'
            )}
          >
            {view.codeLabel}
          </span>
        </div>
        <span className="truncate font-mono text-[11.5px] text-subtle">
          {check.url} <span className="text-faint">· GET · {expectLabel(check.expect)}</span>
        </span>
      </div>

      <div
        className="flex h-7 min-w-[200px] flex-[2_1_260px] items-end gap-[2px]"
        aria-label="Last 60 results"
      >
        {view.bars.map((bar, index) => (
          <span
            key={index}
            title={bar.tip}
            className="min-w-0 flex-1 rounded-[1px]"
            style={{ height: `${bar.heightPct}%`, background: bar.color }}
          />
        ))}
      </div>

      <div className="grid grid-cols-[repeat(3,auto)] gap-x-5 gap-y-0.5 text-[11px] text-subtle">
        <span>Response</span>
        <span>Uptime</span>
        <span>every {intervalLabel(check.intervalSec)}</span>
        <span className="font-mono text-[13px] text-fg">{view.responseLabel}</span>
        <span className="font-mono text-[13px] text-fg">{view.uptimeLabel}</span>
        <span className="font-mono text-xs text-fg-3">{view.nextLabel}</span>
      </div>

      <div className="flex gap-1.5">
        <button
          disabled={busy}
          onClick={() => void act(() => checkNow(check.id), `${check.name} checked`)}
          className={ROW_BUTTON}
        >
          Check now
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void act(
              () => setPaused(check.id, !check.paused),
              `${check.name} ${check.paused ? 'resumed' : 'paused'}`
            )
          }
          className={ROW_BUTTON}
        >
          {check.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          disabled={busy}
          title="Delete check"
          aria-label={`Delete ${check.name}`}
          onClick={() => void act(() => removeCheck(check.id), `${check.name} removed`)}
          className="flex w-7 items-center justify-center rounded-[5px] border border-line-strong text-muted hover:bg-crit/8 hover:text-crit-fg disabled:opacity-50"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export default function UptimePage() {
  const list = usePolled<UptimeList>(UPTIME_URL, POLL_MS);
  const now = useNow();
  const checks = list?.checks ?? [];
  const summary = summarize(checks);

  const stats = [
    {
      label: 'Endpoints up',
      value: `${summary.up} / ${summary.live}`,
      color: summary.up < summary.live ? PALETTE.critFg : PALETTE.text
    },
    {
      label: 'Avg response',
      value: summary.avgResponseMs === null ? '—' : `${summary.avgResponseMs} ms`,
      color: PALETTE.text
    },
    {
      label: 'Uptime · last 60 checks',
      value: summary.uptimePct === null ? '—' : `${summary.uptimePct.toFixed(2)}%`,
      color: PALETTE.text
    },
    { label: 'Paused', value: String(summary.paused), color: PALETTE.text }
  ];

  return (
    <PageBody>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-card px-[18px] py-3.5"
          >
            <span className="text-xs text-muted">{stat.label}</span>
            <span className="font-mono text-[22px] font-medium" style={{ color: stat.color }}>
              {list === null ? '—' : stat.value}
            </span>
          </div>
        ))}
      </div>

      <AddCheckForm />

      <Panel
        className="overflow-hidden"
        title="Endpoints"
        actions={
          <span className="font-mono text-[11.5px] text-subtle">
            GET · {expectSummary(checks)} · timeout 10s · last 60 checks
          </span>
        }
      >
        {list === null && <p className="px-[18px] py-5 text-center text-[12.5px] text-subtle">Loading…</p>}
        {list !== null && checks.length === 0 && (
          <p className="px-[18px] py-5 text-center text-[12.5px] text-subtle">
            No checks yet. Add an endpoint above.
          </p>
        )}
        {now !== null && checks.map(check => <CheckRow key={check.id} check={check} now={now} />)}
      </Panel>
    </PageBody>
  );
}
