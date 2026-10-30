import { describe, expect, it } from 'vitest';

import { checkView, historyBars, HISTORY_SLOTS, summarize } from '@/components/uptime/uptimeView';
import { PALETTE } from '@/lib/theme';
import type { UptimeCheck, UptimeSample } from '@/types/system';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

function sample(
  secondsAgo: number,
  ok: boolean,
  ms: number | null = 120,
  code: number | null = 200
): UptimeSample {
  return { at: new Date(NOW - secondsAgo * 1000).toISOString(), ok, ms, code };
}

function check(history: UptimeSample[], extra: Partial<UptimeCheck> = {}): UptimeCheck {
  return {
    id: 'a',
    name: 'API',
    url: 'https://api.local/health',
    intervalSec: 30,
    expect: '200',
    paused: false,
    history,
    ...extra
  };
}

describe('historyBars', () => {
  it('always returns 60 slots with the newest result on the right', () => {
    const bars = historyBars([sample(10, true)]);
    expect(bars).toHaveLength(HISTORY_SLOTS);
    expect(bars[0].tip).toBe('no data');
    expect(bars.at(-1)!.tip).toBe('120 ms');
  });

  it('colours failures red and slow responses amber', () => {
    const bars = historyBars([sample(20, true, 1500), sample(10, false, null, 503)]);
    expect(bars.at(-2)!.color).toBe(PALETTE.warn);
    expect(bars.at(-1)).toMatchObject({ color: PALETTE.crit, tip: 'failed (503)' });
  });
});

describe('checkView', () => {
  it('reports a failing check as down with its status code', () => {
    const view = checkView(check([sample(40, true), sample(10, false, null, null)]), NOW);
    expect(view).toMatchObject({
      down: true,
      codeLabel: 'timeout',
      responseLabel: '> 10 s',
      uptimeLabel: '50.0%'
    });
  });

  it('counts down to the next probe and drops decimals at 100%', () => {
    const view = checkView(check([sample(10, true)]), NOW);
    expect(view.nextLabel).toBe('next in 20s');
    expect(view.uptimeLabel).toBe('100%');
  });

  it('never reports a paused check as down', () => {
    const view = checkView(check([sample(10, false, null, 500)], { paused: true }), NOW);
    expect(view.down).toBe(false);
    expect(view.nextLabel).toBe('paused');
  });

  it('shows pending before the first result', () => {
    expect(checkView(check([]), NOW)).toMatchObject({ codeLabel: 'pending', uptimeLabel: '—' });
  });
});

describe('summarize', () => {
  it('counts up/live, averages latency of up checks and pools uptime', () => {
    const summary = summarize([
      check([sample(10, true, 100)]),
      check([sample(10, true, 300)], { id: 'b' }),
      check([sample(10, false, null, 500)], { id: 'c' }),
      check([sample(10, true, 50)], { id: 'd', paused: true })
    ]);
    expect(summary).toEqual({ up: 2, live: 3, avgResponseMs: 200, uptimePct: 75, paused: 1 });
  });
});
