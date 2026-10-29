import { PALETTE } from '@/lib/theme';
import type { UptimeCheck, UptimeSample } from '@/types/system';

// Pure presentation maths for the Uptime page: per-check status, the 60-bar
// history strip and the summary cards.

export const HISTORY_SLOTS = 60;
// Responses slower than this draw amber even when they succeeded.
const SLOW_MS = 1000;
// Bar heights scale to the slowest response, floored so fast checks still
// read as bars and capped so one outlier doesn't flatten the rest.
const SCALE_FLOOR_MS = 200;
const SCALE_CAP_MS = 3000;
const MIN_BAR_PCT = 14;
const EMPTY_BAR_PCT = 30;

export interface HistoryBar {
  heightPct: number;
  color: string;
  tip: string;
}

export interface CheckView {
  down: boolean;
  codeLabel: string;
  codeOk: boolean;
  responseLabel: string;
  uptimeLabel: string;
  nextLabel: string;
  bars: HistoryBar[];
}

function uptimePercent(samples: UptimeSample[], allUp: boolean): string {
  if (samples.length === 0) return '—';
  const ok = samples.filter(sample => sample.ok).length;
  return `${((ok / samples.length) * 100).toFixed(allUp ? 0 : 1)}%`;
}

export function historyBars(history: UptimeSample[]): HistoryBar[] {
  const scale = Math.max(SCALE_FLOOR_MS, ...history.map(sample => Math.min(sample.ms ?? 0, SCALE_CAP_MS)));
  const bars: HistoryBar[] = history.slice(-HISTORY_SLOTS).map(sample => ({
    heightPct: sample.ok
      ? Math.round(Math.max(MIN_BAR_PCT, Math.min(100, ((sample.ms ?? 0) / scale) * 100)))
      : 100,
    color: !sample.ok ? PALETTE.crit : (sample.ms ?? 0) > SLOW_MS ? PALETTE.warn : PALETTE.ok,
    tip: sample.ok ? `${sample.ms} ms` : `failed (${sample.code ?? sample.error ?? 'timeout'})`
  }));
  // Left-pad so the newest result is always at the right edge.
  const empty: HistoryBar = { heightPct: EMPTY_BAR_PCT, color: PALETTE.track, tip: 'no data' };
  return [...Array<HistoryBar>(HISTORY_SLOTS - bars.length).fill(empty), ...bars];
}

export function checkView(check: UptimeCheck, now: number): CheckView {
  const last = check.history.at(-1);
  const down = !check.paused && last !== undefined && !last.ok;
  const all = check.history.length > 0 && check.history.every(sample => sample.ok);
  const nextAt = last ? new Date(last.at).getTime() + check.intervalSec * 1000 : now;
  const nextIn = Math.max(0, Math.ceil((nextAt - now) / 1000));

  return {
    down,
    codeLabel: !last ? 'pending' : last.code === null ? (last.error ?? 'timeout') : String(last.code),
    codeOk: last?.ok ?? true,
    responseLabel: !last
      ? '—'
      : last.ms === null
        ? last.error === 'unreachable'
          ? 'no answer'
          : '> 10 s'
        : `${last.ms} ms`,
    uptimeLabel: uptimePercent(check.history, all),
    nextLabel: check.paused ? 'paused' : `next in ${nextIn}s`,
    bars: historyBars(check.history)
  };
}

export interface UptimeSummary {
  up: number;
  live: number;
  avgResponseMs: number | null;
  uptimePct: number | null;
  paused: number;
}

export function summarize(checks: UptimeCheck[]): UptimeSummary {
  const live = checks.filter(check => !check.paused);
  const upChecks = live.filter(check => check.history.at(-1)?.ok === true);
  const latencies = upChecks.map(check => check.history.at(-1)?.ms ?? null).filter(ms => ms !== null);
  const samples = checks.flatMap(check => check.history);

  return {
    up: upChecks.length,
    live: live.length,
    avgResponseMs: latencies.length
      ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
      : null,
    uptimePct: samples.length ? (samples.filter(sample => sample.ok).length / samples.length) * 100 : null,
    paused: checks.length - live.length
  };
}
