import { describe, expect, it } from 'vitest';

import { eventCounts, eventMarks, pointLabel, withLive } from '@/components/overview/chartData';
import type { HostEvent } from '@/types/system';

const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const events: HostEvent[] = [
  { id: '1', kind: 'reboot', label: 'Host rebooted · reason unknown', at: ago(30 * 60_000) },
  { id: '2', kind: 'deploy', label: 'web redeployed', at: ago(3 * 3_600_000) },
  { id: '3', kind: 'restart', label: 'db started', at: ago(10 * 24 * 3_600_000) }
];

describe('eventMarks', () => {
  it('places events inside the window and drops the rest', () => {
    const marks = eventMarks(events, '1h', NOW);
    expect(marks).toHaveLength(1);
    expect(marks[0].fraction).toBeCloseTo(0.5);
    expect(marks[0].tip).toMatch(/^Reboot · Host rebooted/);
    expect(eventMarks(events, '24h', NOW)).toHaveLength(2);
  });
});

describe('eventCounts', () => {
  it('counts each kind within the window', () => {
    expect(eventCounts(events, '7d', NOW)).toEqual({ reboot: 1, deploy: 1, restart: 0 });
  });
});

describe('pointLabel', () => {
  it('shows the clock within a day and the date for a week', () => {
    const at = new Date(2026, 9, 27, 14, 5).toISOString();
    expect(pointLabel(at, '1h')).toBe('14:05');
    expect(pointLabel(at, '7d')).toBe('10-27 14:05');
  });
});

describe('withLive', () => {
  it('replaces the filling bucket with the live reading on minute ranges', () => {
    expect(withLive([1, 2, 3], 9, '1h')).toEqual([1, 2, 9]);
    expect(withLive([1, 2, 3], 9, '6h')).toEqual([1, 2, 9]);
    expect(withLive([1, 2, 3], null, '1h')).toEqual([1, 2, 3]);
    expect(withLive([], 4, '1h')).toEqual([4]);
  });

  it('keeps 15-minute and hourly averages as they are', () => {
    expect(withLive([1, 2, 3], 9, '24h')).toEqual([1, 2, 3]);
    expect(withLive([1, 2, 3], 9, '7d')).toEqual([1, 2, 3]);
  });
});
