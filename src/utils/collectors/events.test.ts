import { describe, expect, it } from 'vitest';

import { detectEvents, snapshotOf } from '@/utils/collectors/events';

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
