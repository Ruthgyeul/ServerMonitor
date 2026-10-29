'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SquareTerminal, X } from 'lucide-react';

import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';
import type { LogLevel, LogLine, LogSourceKind } from '@/types/system';
import { formatTimestamp } from '@/utils/timeFormat';

// Side drawer with the recent output of one unit or container: level filter,
// text filter, follow (re-reads the tail every few seconds and sticks to the
// bottom) and a .log download.

export interface LogSource {
  kind: LogSourceKind;
  name: string;
  // Header line, e.g. "journalctl -u nginx.service".
  title: string;
  subtitle?: string;
}

const FOLLOW_MS = 3000;
const TAIL_LINES = 300;

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

type Load = { status: 'loading' } | { status: 'ok'; lines: LogLine[] } | { status: 'error'; message: string };

function useLogTail(source: LogSource, follow: boolean): Load {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchTail = useCallback(async (): Promise<Load> => {
    const params = new URLSearchParams({ kind: source.kind, name: source.name, lines: String(TAIL_LINES) });
    try {
      const response = await fetch(`/api/logs?${params}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        data?: LogLine[];
        error?: string;
      };
      if (!response.ok || !body.success || !body.data) {
        return { status: 'error', message: body.error ?? `HTTP ${response.status}` };
      }
      return { status: 'ok', lines: body.data };
    } catch {
      return { status: 'error', message: 'Could not reach the server' };
    }
  }, [source.kind, source.name]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next = await fetchTail();
      if (!cancelled)
        setLoad(previous => (next.status === 'error' && previous.status === 'ok' ? previous : next));
    };
    void run();
    const timer = follow ? setInterval(run, FOLLOW_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [fetchTail, follow]);

  return load;
}

export function LogDrawer({ source, onClose }: { source: LogSource; onClose: () => void }) {
  const [follow, setFollow] = useState(true);
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
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

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
            <span className="truncate font-mono text-[12.5px] text-fg">{source.title}</span>
            <span className={cn('text-[11.5px]', load.status === 'error' ? 'text-crit-fg' : 'text-fg-3')}>
              {load.status === 'error'
                ? load.message
                : (source.subtitle ??
                  (follow ? `following · refreshes every ${FOLLOW_MS / 1000}s` : 'paused'))}
            </span>
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
          <Segmented options={LEVELS} value={level} onChange={setLevel} label="Log level" />
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
            className={cn(
              'rounded-md px-[11px] py-[5px] text-xs',
              follow ? 'bg-accent/14 text-link-hover' : 'text-subtle'
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
          {visible.length === all.length ? `${all.length} lines` : `${visible.length} of ${all.length} lines`}
        </div>
      </aside>
    </>
  );
}
