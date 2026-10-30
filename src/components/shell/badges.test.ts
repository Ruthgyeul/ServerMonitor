import { describe, expect, it } from 'vitest';

import { badgeFor, isMuted, type BadgeSources } from '@/components/shell/badges';
import type { ServerData, ServiceUnit } from '@/types/system';
import { toDashboardData } from '@/utils/dashboardData';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

function sources(raw: Partial<ServerData> = {}, extra: Partial<BadgeSources> = {}): BadgeSources {
  const data = toDashboardData({
    cpu: { usage: 1, cores: 4, temperature: 40 },
    memory: { used: 1, total: 4, percentage: 25 },
    disk: { used: 1, total: 4, percentage: 25 },
    network: { download: 0, upload: 0, ping: 1, errorRates: { rx: '0', tx: '0' } },
    uptime: { days: 0, hours: 1, minutes: 0 },
    temperature: { cpu: 40, gpu: 'N/A', motherboard: 'N/A' },
    fan: { cpu: 0, case1: 0, case2: 0 },
    processes: [],
    ...raw
  });
  return { data, cluster: null, uptime: null, jobs: null, units: null, now: NOW, ...extra };
}

const unit = (name: string, active: string): ServiceUnit => ({
  name,
  description: name,
  load: 'loaded',
  active,
  sub: active === 'active' ? 'running' : 'dead',
  since: null
});

describe('badgeFor', () => {
  it('shows failed services in red, else active/total', () => {
    expect(badgeFor('services', sources({ services: { failed: 2, failedUnits: ['a', 'b'] } }))).toEqual({
      text: '2',
      alarm: true
    });
    const units = [unit('a.service', 'active'), unit('b.service', 'inactive'), unit('c.service', 'active')];
    expect(badgeFor('services', sources({}, { units }))).toEqual({ text: '2/3', alarm: false });
    expect(badgeFor('services', sources())).toBeNull();
  });

  it('counts custom rules', () => {
    expect(badgeFor('rules', sources({ overrideCount: 3 }))).toEqual({ text: '3 custom', alarm: false });
    expect(badgeFor('rules', sources({ overrideCount: 0 }))).toBeNull();
  });

  it('says muted while notifications are muted', () => {
    const mutedUntil = new Date(NOW + 60_000).toISOString();
    expect(
      badgeFor(
        'notifications',
        sources({ mute: { globalMutedUntil: mutedUntil, quietHours: null, quietNow: false } })
      )
    ).toEqual({ text: 'muted', alarm: false });
    expect(badgeFor('notifications', sources())).toBeNull();
  });
});

describe('isMuted', () => {
  it('ignores a mute that already ended and honours quiet hours', () => {
    const past = new Date(NOW - 1000).toISOString();
    expect(
      isMuted(sources({ mute: { globalMutedUntil: past, quietHours: null, quietNow: false } }).data, NOW)
    ).toBe(false);
    expect(
      isMuted(
        sources({ mute: { globalMutedUntil: null, quietHours: '22:00-07:00', quietNow: true } }).data,
        NOW
      )
    ).toBe(true);
  });
});
