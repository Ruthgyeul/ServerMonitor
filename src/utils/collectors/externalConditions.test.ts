import { describe, expect, it } from 'vitest';

import { jobConditions, unitConditions, uptimeConditions } from '@/utils/collectors/externalConditions';
import type { ScheduledJob, UptimeCheck } from '@/types/system';

const sample = (ok: boolean, code: number | null) => ({
  at: '2026-10-29T12:00:00.000Z',
  ok,
  ms: ok ? 80 : null,
  code
});

describe('uptimeConditions', () => {
  it('flags live checks whose last probe failed', () => {
    const checks: UptimeCheck[] = [
      {
        id: 'a',
        name: 'API',
        url: 'https://a',
        intervalSec: 30,
        paused: false,
        history: [sample(false, 503)]
      },
      {
        id: 'b',
        name: 'Web',
        url: 'https://b',
        intervalSec: 30,
        paused: false,
        history: [sample(false, null)]
      },
      {
        id: 'c',
        name: 'Paused',
        url: 'https://c',
        intervalSec: 30,
        paused: true,
        history: [sample(false, 500)]
      },
      { id: 'd', name: 'Up', url: 'https://d', intervalSec: 30, paused: false, history: [sample(true, 200)] }
    ];
    expect(uptimeConditions(checks).map(condition => condition.message)).toEqual([
      'HTTP check failed: API (503)',
      'HTTP check failed: Web (timeout)'
    ]);
  });
});

describe('jobConditions', () => {
  const job = (extra: Partial<ScheduledJob>): ScheduledJob => ({
    id: 'x.timer',
    name: 'x',
    kind: 'maintenance',
    service: 'x.service',
    schedule: '',
    human: '',
    command: null,
    enabled: true,
    running: false,
    lastRunAt: null,
    lastDurationSec: null,
    lastResult: 'failed',
    nextRunAt: null,
    history: [],
    ...extra
  });

  it('raises backups as critical and other jobs as warnings, skipping disabled or running ones', () => {
    const conditions = jobConditions([
      job({ id: 'b.timer', name: 'Backup', kind: 'backup' }),
      job({ id: 'm.timer', name: 'Vacuum' }),
      job({ id: 'off.timer', enabled: false }),
      job({ id: 'run.timer', running: true }),
      job({ id: 'ok.timer', lastResult: 'success' })
    ]);
    expect(conditions.map(condition => [condition.key, condition.level])).toEqual([
      ['job:b.timer', 'critical'],
      ['job:m.timer', 'warning']
    ]);
  });
});

describe('unitConditions', () => {
  it('maps failed units to critical conditions', () => {
    expect(unitConditions(['nginx.service'])).toEqual([
      {
        key: 'svc:nginx.service',
        level: 'critical',
        message: 'Service failed: nginx.service',
        recoveredMessage: 'Service recovered: nginx.service',
        rule: 'systemctl --failed'
      }
    ]);
  });
});
