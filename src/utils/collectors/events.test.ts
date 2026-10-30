import { describe, expect, it } from 'vitest';

import {
  detectEvents,
  detectUnitRestarts,
  exitCodeOf,
  parseLastReboots,
  rebootHistory,
  snapshotOf
} from '@/utils/collectors/events';

const AT = Date.UTC(2026, 9, 29, 12, 0, 0);
const BOOT = '2026-10-29T03:00:00.000Z';

const ctr = (name: string, id: string, state = 'running', image = `${name}:1`) => ({
  name,
  id,
  state,
  image
});

describe('detectEvents', () => {
  it('reports the current boot on the very first run', () => {
    const events = detectEvents(null, snapshotOf(BOOT, [ctr('redis', 'a')]), AT, 'clean shutdown');
    expect(events).toEqual([
      { kind: 'reboot', label: 'Host rebooted · clean shutdown', at: Date.parse(BOOT) }
    ]);
  });

  it('ignores boot-time jitter but catches a real reboot', () => {
    const prev = snapshotOf(BOOT, []);
    expect(detectEvents(prev, snapshotOf('2026-10-29T03:00:02.000Z', []), AT)).toEqual([]);
    const rebooted = detectEvents(prev, snapshotOf('2026-10-29T11:00:00.000Z', []), AT);
    expect(rebooted).toHaveLength(1);
    expect(rebooted[0].label).toBe('Host rebooted · reason unknown');
  });

  it('classifies container transitions into deploys and restarts', () => {
    const prev = snapshotOf(BOOT, [
      ctr('web', 'a'),
      ctr('db', 'b', 'exited'),
      ctr('cache', 'c', 'restarting')
    ]);
    const next = snapshotOf(BOOT, [
      ctr('web', 'z', 'running', 'web:2'),
      ctr('db', 'b'),
      ctr('cache', 'c'),
      ctr('proxy', 'p')
    ]);
    expect(detectEvents(prev, next, AT).map(event => [event.kind, event.label])).toEqual([
      ['deploy', 'web redeployed (web:2)'],
      ['restart', 'db started'],
      ['restart', 'cache restarted'],
      ['deploy', 'proxy created (proxy:1)']
    ]);
  });

  it('stays quiet when nothing changed or the first roster arrives', () => {
    const steady = snapshotOf(BOOT, [ctr('web', 'a')]);
    expect(detectEvents(steady, steady, AT)).toEqual([]);
    expect(detectEvents(snapshotOf(BOOT, []), steady, AT)).toEqual([]);
  });

  it('does not report containers that are not running', () => {
    const prev = snapshotOf(BOOT, [ctr('job', 'a', 'exited')]);
    expect(detectEvents(prev, snapshotOf(BOOT, [ctr('job', 'b', 'exited')]), AT)).toEqual([]);
  });
});

describe('reboot reasons and container exits', () => {
  it('labels a reboot onto a new kernel as a kernel update', () => {
    const prev = snapshotOf(BOOT, [], '6.8.0-45-generic');
    const next = snapshotOf('2026-10-29T11:00:00.000Z', [], '6.8.0-48-generic');
    expect(detectEvents(prev, next, AT, 'clean shutdown')[0].label).toBe('Host rebooted · kernel update');
  });

  it('reports a running container that exited, with its exit code', () => {
    const prev = snapshotOf(BOOT, [{ ...ctr('certbot', 'a'), status: 'Up 2 minutes' }]);
    const next = snapshotOf(BOOT, [{ ...ctr('certbot', 'a', 'exited'), status: 'Exited (0) 3 seconds ago' }]);
    expect(detectEvents(prev, next, AT)).toEqual([
      { kind: 'exit', label: 'Container certbot exited (0)', at: AT }
    ]);
    expect(exitCodeOf('Exited (137) 1 minute ago')).toBe(137);
    expect(exitCodeOf('Up 3 hours')).toBeNull();
  });
});

describe('detectUnitRestarts', () => {
  it('reports units whose start time moved or restart counter went up', () => {
    const prev = {
      'nginx.service': { since: '2026-10-29T03:00:00.000Z', restarts: 0 },
      'redis.service': { since: '2026-10-29T03:00:00.000Z', restarts: 1 },
      'idle.service': { since: null, restarts: null }
    };
    const next = {
      'nginx.service': { since: '2026-10-29T11:30:00.000Z', restarts: 0 },
      'redis.service': { since: '2026-10-29T03:00:00.000Z', restarts: 2 },
      'idle.service': { since: '2026-10-29T11:00:00.000Z', restarts: 0 },
      'new.service': { since: '2026-10-29T11:00:00.000Z', restarts: 0 }
    };
    expect(detectUnitRestarts(prev, next, AT).map(event => event.label)).toEqual([
      'nginx.service restarted',
      'redis.service restarted'
    ]);
    expect(detectUnitRestarts(null, next, AT)).toEqual([]);
  });
});

describe('reboot backfill', () => {
  const output = `reboot   system boot  6.8.0-48-generic Wed Oct 29 03:00:05 2026   still running
reboot   system boot  6.8.0-45-generic Thu Oct 23 17:06:12 2026 - Wed Oct 29 02:59:01 2026  (5+09:52)
reboot   system boot  6.8.0-45-generic Mon Oct 20 08:00:00 2026 - Thu Oct 23 17:05:00 2026  (3+09:05)

wtmp begins Mon Oct  1 00:00:00 2026`;

  it('parses boots oldest first and labels kernel changes', () => {
    const boots = parseLastReboots(output);
    expect(boots.map(boot => boot.kernel)).toEqual([
      '6.8.0-45-generic',
      '6.8.0-45-generic',
      '6.8.0-48-generic'
    ]);
    const current = boots[2].at;
    expect(rebootHistory(boots, current).map(event => event.label)).toEqual([
      'Host rebooted · reason unknown',
      'Host rebooted · reason unknown'
    ]);
    expect(rebootHistory(boots, null).at(-1)!.label).toBe('Host rebooted · kernel update');
  });
});
