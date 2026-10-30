import { describe, expect, it } from 'vitest';

import { containerStatus, formatSize } from '@/components/docker/format';

describe('formatSize', () => {
  it('uses the largest decimal unit', () => {
    expect(formatSize(null)).toBe('—');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(48_200_000)).toBe('48 MB');
    expect(formatSize(1_840_000_000)).toBe('1.84 GB');
  });
});

describe('containerStatus', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  const base = { status: 'Up 3 hours', startedAt: null, finishedAt: null, exitCode: null };

  it('builds the status from start and finish times', () => {
    const startedAt = new Date(now - 9 * 3_600_000).toISOString();
    const finishedAt = new Date(now - 6 * 3_600_000).toISOString();
    expect(containerStatus({ ...base, state: 'running', startedAt }, now)).toBe('Up 9 hours');
    expect(containerStatus({ ...base, state: 'paused', startedAt }, now)).toBe('Up 9 hours (Paused)');
    expect(containerStatus({ ...base, state: 'exited', finishedAt, exitCode: 137 }, now)).toBe(
      'Exited (137) 6 hours ago'
    );
    expect(containerStatus({ ...base, state: 'restarting' }, now)).toBe('Restarting…');
  });

  it("falls back to docker's own status text", () => {
    expect(containerStatus({ ...base, state: 'running' }, now)).toBe('Up 3 hours');
    expect(containerStatus({ ...base, state: 'exited', status: 'Exited (1) 2 days ago' }, now)).toBe(
      'Exited (1) 2 days ago'
    );
  });
});
