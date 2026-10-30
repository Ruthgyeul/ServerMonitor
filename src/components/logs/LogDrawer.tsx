'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SquareTerminal, X } from 'lucide-react';

import { useToast } from '@/components/providers/ToastProvider';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';
import type { LogLevel, LogLine, LogSourceKind } from '@/types/system';
import { formatTimestamp } from '@/utils/timeFormat';

// Side drawer with the output of one unit or container: level filter, text
// filter, follow (new lines streamed over SSE, falling back to re-reading the
// tail every few seconds) and a .log download. With a `run` scope it shows one
// finished run instead (Jobs → Output) and doesn't follow.

export interface LogSource {
  kind: LogSourceKind;
  name: string;
  // Header line; defaults to the equivalent command (see logTitle).
  title?: string;
  subtitle?: string;
  // One run only: a systemd invocation, or everything since the run started (ISO).
  run?: { invocation?: string | null; since?: string | null };
}

export const TAIL_LINES = 500;
const POLL_MS = 3000;
const ACTIVE_CHECK_MS = 15_000;

const LEVELS = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' }
] as const;

const TAG: Record<LogLevel, { label: string; className: string; row: string }> = {
  error: { label: 'ERR', className: 'text-crit-fg', row: 'bg-crit/7' },
  warn: { label: 'WRN', className: 'text-warn-fg', row: '' },
  info: { label: 'INF', className: 'text-subtle', row: '' }
};

// The command a reader would type to see the same output.
export function logTitle(source: LogSource): string {
  if (source.title) return source.title;
  if (source.run) return `journalctl -u ${source.name} · last run`;
  return source.kind === 'container'
    ? `docker logs -f --tail ${TAIL_LINES} ${source.name}`
    : `journalctl -u ${source.name} -f -n ${TAIL_LINES}`;
}

export function logSubtitle(
  source: LogSource,
  active: boolean
): { text: string; tone: 'ok' | 'warn' | 'plain' } {
  if (source.subtitle) return { text: source.subtitle, tone: 'plain' };
  if (source.run) return { text: 'output of the most recent run', tone: 'plain' };
  if (active) return { text: 'streaming', tone: 'ok' };
  return {
    text:
      source.kind === 'container'
        ? 'container is not running · no new output'
        : 'unit is not active · no new output',
    tone: 'warn'
  };
}

export function tailQuery(source: LogSource, lines: number = TAIL_LINES): string {
  const params = new URLSearchParams({ kind: source.kind, name: source.name, lines: String(lines) });
  if (source.run?.invocation) params.set('invocation', source.run.invocation);
  else if (source.run?.since) params.set('since', source.run.since);
  return params.toString();
}

type Load =
  | { status: 'loading' }
  | { status: 'ok'; lines: LogLine[]; active: boolean }
  | { status: 'error'; message: string };

async function fetchTail(query: string): Promise<Load> {
  try {
    const response = await fetch(`/api/logs?${query}`, { cache: 'no-store' });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { lines: LogLine[]; active: boolean };
      error?: string;
    };
    if (!response.ok || !body.success || !body.data) {
      return { status: 'error', message: body.error ?? `HTTP ${response.status}` };
    }
    return { status: 'ok', lines: body.data.lines, active: body.data.active };
  } catch {
    return { status: 'error', message: 'Could not reach the server' };
  }
}

// Loads the tail once, then while following appends lines from the SSE stream;
// if the stream can't open or ends, re-reads the tail every few seconds.
function useLogTail(source: LogSource, follow: boolean): Load {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const query = tailQuery(source);
  const activeQuery = tailQuery(source, 1);
  const streamUrl = `/api/logs/stream?${new URLSearchParams({ kind: source.kind, name: source.name })}`;
  const following = follow && !source.run;

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let activeCheck: ReturnType<typeof setInterval> | null = null;
    let events: EventSource | null = null;

    const refresh = async () => {
      const next = await fetchTail(query);
      if (!cancelled)
        setLoad(previous => (next.status === 'error' && previous.status === 'ok' ? previous : next));
    };

    const startPolling = () => {
      events?.close();
      events = null;
      if (activeCheck) clearInterval(activeCheck);
      if (!poll && !cancelled) poll = setInterval(() => void refresh(), POLL_MS);
    };

    const startStream = () => {
      if (cancelled || !following) return;
      if (typeof EventSource === 'undefined') return startPolling();
      events = new EventSource(streamUrl);
      events.onmessage = event => {
        let lines: LogLine[];
        try {
          lines = JSON.parse(event.data as string) as LogLine[];
        } catch {
          return;
        }
        setLoad(previous =>
          previous.status === 'ok'
            ? { ...previous, lines: [...previous.lines, ...lines].slice(-TAIL_LINES) }
            : previous
        );
      };
      events.addEventListener('end', startPolling);
      events.onerror = startPolling;
      // The stream carries lines only; the running state comes from a light re-read.
      activeCheck = setInterval(async () => {
        const next = await fetchTail(activeQuery);
        if (!cancelled && next.status === 'ok')
          setLoad(previous => (previous.status === 'ok' ? { ...previous, active: next.active } : previous));
      }, ACTIVE_CHECK_MS);
    };

    void refresh().then(startStream);

    return () => {
      cancelled = true;
      events?.close();
      if (poll) clearInterval(poll);
      if (activeCheck) clearInterval(activeCheck);
    };
  }, [query, activeQuery, streamUrl, following]);

  return load;
}

const SUBTITLE_TONE = { ok: 'text-ok-fg', warn: 'text-warn-fg', plain: 'text-fg-3' } as const;

export function LogDrawer({ source, onClose }: { source: LogSource; onClose: () => void }) {
  const flash = useToast();
  const [follow, setFollow] = useState(!source.run);
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [query, setQuery] = useState('');
  const load = useLogTail(source, follow);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const all = useMemo(() => (load.status === 'ok' ? load.lines : []), [load]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter(
      line =>
        (level === 'all' || line.level === level) && (!needle || line.message.toLowerCase().includes(needle))
    );
  }, [all, level, query]);

  // Stick to the newest line while following.
  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [visible, follow]);

  const download = () => {
    const text = all.map(line => `${line.at} ${line.level.toUpperCase()} ${line.message}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${source.name}.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash('Log downloaded');
  };

  const subtitle =
    load.status === 'error'
      ? { text: load.message, className: 'text-crit-fg' }
      : (() => {
          const { text, tone } = logSubtitle(source, load.status === 'ok' && load.active);
          return { text: load.status === 'loading' ? '' : text, className: SUBTITLE_TONE[tone] };
        })();

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[44] bg-[rgba(5,6,9,0.55)]" />
      <aside
        role="dialog"
        aria-label={`Logs for ${source.name}`}
        className="fixed inset-y-0 right-0 z-[45] flex w-[760px] max-w-[100vw] flex-col border-l border-line-strong bg-sidebar shadow-[-20px_0_50px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-[18px] py-3.5">
          <SquareTerminal size={15} className="shrink-0 text-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-mono text-[12.5px] text-fg">{logTitle(source)}</span>
            <span className={cn('min-h-[17px] text-[11.5px]', subtitle.className)}>{subtitle.text}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-white/6 hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-[18px] py-2.5">
          <Segmented options={LEVELS} value={level} onChange={setLevel} font="sans" label="Log level" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Filter lines…"
            aria-label="Filter log lines"
            className="min-w-0 flex-[1_1_160px] rounded-md border border-line-strong bg-[#12151c] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
          />
          <button
            onClick={() => setFollow(on => !on)}
            aria-pressed={follow}
            disabled={Boolean(source.run)}
            title={source.run ? 'A finished run has no new output' : undefined}
            className={cn(
              'rounded-md px-[11px] py-[5px] text-xs disabled:cursor-not-allowed disabled:opacity-50',
              follow ? 'bg-accent text-canvas' : 'bg-white/6 text-fg-3'
            )}
          >
            Follow
          </button>
          <button
            onClick={download}
            disabled={all.length === 0}
            title="Download .log"
            className="rounded-md border border-line-strong px-[11px] py-[5px] text-xs text-fg-3 hover:bg-white/5 disabled:opacity-50"
          >
            Download
          </button>
        </div>
        <div ref={scroller} className="flex-1 overflow-auto py-2 font-mono text-[11.5px] leading-[1.6]">
          {load.status === 'loading' && <p className="px-[18px] py-4 text-subtle">Loading…</p>}
          {load.status !== 'loading' && visible.length === 0 && (
            <p className="px-[18px] py-4 text-subtle">
              {all.length === 0 ? 'No output yet.' : 'No lines match.'}
            </p>
          )}
          {visible.map((line, index) => (
            <div
              key={`${line.at}-${index}`}
              className={cn('grid grid-cols-[118px_30px_1fr] gap-2.5 px-[18px] py-px', TAG[line.level].row)}
            >
              <span className="text-faint">{formatTimestamp(new Date(line.at).getTime()).slice(5)}</span>
              <span className={TAG[line.level].className}>{TAG[line.level].label}</span>
              <span className="break-all whitespace-pre-wrap text-fg-2">{line.message}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-[18px] py-2 font-mono text-[11px] text-subtle">
          {visible.length} of {all.length} lines
        </div>
      </aside>
    </>
  );
}
