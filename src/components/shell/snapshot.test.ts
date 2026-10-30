import { describe, expect, it } from 'vitest';

import { buildSnapshot } from '@/components/shell/snapshot';
import type { ServerData } from '@/types/system';
import { toDashboardData } from '@/utils/dashboardData';

const raw: ServerData = {
  cpu: { usage: 12.345, cores: 4, temperature: 51.26 },
  memory: { used: 4, total: 16, percentage: 25.04 },
  disk: { used: 100, total: 400, percentage: 25 },
  network: { download: 12.3456, upload: 1.2, ping: 8, errorRates: { rx: '0', tx: '0' } },
  uptime: { days: 1, hours: 2, minutes: 3 },
  temperature: { cpu: 51.26, gpu: 'N/A', motherboard: 'N/A' },
  fan: { cpu: 0, case1: 0, case2: 0 },
  processes: [],
  host: {
    hostname: 'ruthsub',
    os: 'Ubuntu',
    kernel: '6.8',
    arch: 'x64',
    bootTime: '2026-10-29T00:00:00.000Z',
    rebootReason: null,
    virtualization: null
  },
  load: { avg1: 2, avg5: 1, avg15: 1, running: null, avg30: null, avg30WindowSeconds: 0 },
  docker: {
    available: true,
    running: 1,
    total: 1,
    netRxRate: 0,
    netTxRate: 0,
    containers: [
      {
        id: 'abc',
        name: 'nginx',
        image: 'nginx:1.27',
        state: 'running',
        status: 'Up 2 hours',
        cpuPercent: 1,
        memUsedMb: 10,
        memLimitMb: null,
        memPercent: null,
        netRxBytes: null,
        netTxBytes: null,
        netRxRate: null,
        netTxRate: null,
        blockReadBytes: null,
        blockWriteBytes: null
      }
    ]
  },
  services: { failed: 1, failedUnits: ['backup.service'] },
  activeAlerts: [
    {
      key: 'cpu',
      level: 'critical',
      message: 'CPU usage 95%',
      since: '2026-10-29T00:00:00.000Z',
      short: 'CPU 95% > 90%'
    }
  ]
};

describe('buildSnapshot', () => {
  it('keeps the design snapshot fields only', () => {
    const snapshot = buildSnapshot(toDashboardData(raw), Date.UTC(2026, 9, 30, 4, 0, 0));
    expect(snapshot).toEqual({
      host: 'ruthsub',
      at: '2026-10-30T04:00:00.000Z',
      cpu: 12.3,
      memory: 25,
      disk: 25,
      temperature: 51.3,
      loadPerCore: 0.5,
      network: { downloadKBs: 12.35, uploadKBs: 1.2 },
      activeAlerts: ['CPU 95% > 90%'],
      containers: [{ name: 'nginx', image: 'nginx:1.27', state: 'running' }],
      failedUnits: ['backup.service']
    });
  });

  it('reports a missing temperature as null', () => {
    const snapshot = buildSnapshot(toDashboardData({ ...raw, cpu: { ...raw.cpu, temperature: 'N/A' } }), 0);
    expect(snapshot.temperature).toBeNull();
  });
});
