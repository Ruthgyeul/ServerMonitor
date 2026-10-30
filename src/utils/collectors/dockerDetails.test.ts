import { describe, expect, it } from 'vitest';

import {
  parseContainerInspect,
  parseImages,
  parseNetworkInspect,
  parseSystemDf,
  parseVolumeSizes
} from '@/utils/collectors/dockerDetails';

describe('parseContainerInspect', () => {
  it('extracts ports, networks, mounts, policy, health, command and memory limit', () => {
    const json = JSON.stringify([
      {
        Id: 'abcdef1234567890',
        Name: '/postgres',
        Image: 'sha256:9b2d64c0e1aa77',
        Created: '2026-10-15T10:00:00.123Z',
        Path: 'docker-entrypoint.sh',
        Args: ['postgres'],
        State: {
          Status: 'running',
          Health: { Status: 'healthy' },
          StartedAt: '2026-10-29T03:00:00.5Z',
          FinishedAt: '0001-01-01T00:00:00Z',
          ExitCode: 0
        },
        Config: { Image: 'postgres:16-alpine' },
        HostConfig: { RestartPolicy: { Name: 'unless-stopped' }, Memory: 1073741824 },
        NetworkSettings: {
          Networks: { monitor_net: {} },
          Ports: {
            '5432/tcp': [
              { HostIp: '127.0.0.1', HostPort: '5432' },
              { HostIp: '::', HostPort: '5432' }
            ],
            '9999/tcp': null
          }
        },
        Mounts: [
          { Type: 'volume', Name: 'postgres_data', Destination: '/var/lib/postgresql/data', RW: true },
          { Type: 'bind', Source: '/etc/pg.conf', Destination: '/etc/pg.conf', RW: false }
        ]
      }
    ]);
    expect(parseContainerInspect(json)).toEqual([
      {
        id: 'abcdef123456',
        name: 'postgres',
        image: 'postgres:16-alpine',
        imageId: '9b2d64c0e1aa',
        state: 'running',
        ports: ['127.0.0.1:5432→5432/tcp', '9999/tcp'],
        networks: ['monitor_net'],
        mounts: ['postgres_data → /var/lib/postgresql/data', '/etc/pg.conf → /etc/pg.conf (ro)'],
        restartPolicy: 'unless-stopped',
        health: 'healthy',
        command: 'docker-entrypoint.sh postgres',
        createdAt: '2026-10-15T10:00:00.123Z',
        memLimitMb: 1024,
        startedAt: '2026-10-29T03:00:00.500Z',
        finishedAt: null,
        exitCode: 0
      }
    ]);
  });

  it('returns nothing for malformed output', () => {
    expect(parseContainerInspect('oops')).toEqual([]);
  });
});

describe('parseImages', () => {
  it('reads repository, tag, short id, size and creation time', () => {
    const out = JSON.stringify({
      ID: 'sha256:3f9a1c2e7b04ffff',
      Repository: 'nginx',
      Tag: '1.27-alpine',
      Size: '48.2MB',
      CreatedAt: '2026-10-01 12:00:00 +0000 UTC'
    });
    expect(parseImages(out)).toEqual([
      {
        id: '3f9a1c2e7b04',
        repository: 'nginx',
        tag: '1.27-alpine',
        sizeBytes: 48.2e6,
        createdAt: '2026-10-01T12:00:00.000Z'
      }
    ]);
  });
});

describe('parseNetworkInspect', () => {
  it('lists subnet and member containers', () => {
    const json = JSON.stringify([
      {
        Name: 'monitor_net',
        Driver: 'bridge',
        IPAM: { Config: [{ Subnet: '172.20.0.0/16' }] },
        Containers: { a: { Name: 'redis' }, b: { Name: 'api' } }
      },
      { Name: 'host', Driver: 'host', IPAM: { Config: [] }, Containers: {} }
    ]);
    expect(parseNetworkInspect(json)).toEqual([
      { name: 'monitor_net', driver: 'bridge', subnet: '172.20.0.0/16', containers: ['api', 'redis'] },
      { name: 'host', driver: 'host', subnet: null, containers: [] }
    ]);
  });
});

describe('parseSystemDf', () => {
  it('maps the df rows and strips the reclaimable percentage', () => {
    const out = [
      JSON.stringify({ Type: 'Images', Size: '1.88GB', Reclaimable: '409MB (21%)' }),
      JSON.stringify({ Type: 'Local Volumes', Size: '2.07GB', Reclaimable: '0B (0%)' }),
      JSON.stringify({ Type: 'Build Cache', Size: '1.31GB', Reclaimable: '1.31GB' })
    ].join('\n');
    expect(parseSystemDf(out)).toEqual([
      { type: 'images', sizeBytes: 1.88e9, reclaimableBytes: 409e6 },
      { type: 'volumes', sizeBytes: 2.07e9, reclaimableBytes: 0 },
      { type: 'buildCache', sizeBytes: 1.31e9, reclaimableBytes: 1.31e9 }
    ]);
  });
});

describe('parseVolumeSizes', () => {
  it('reads per-volume sizes and tolerates bad JSON', () => {
    const sizes = parseVolumeSizes(
      JSON.stringify({
        Volumes: [
          { Name: 'pg', Size: '1.84GB' },
          { Name: 'x', Size: 'N/A' }
        ]
      })
    );
    expect(sizes.get('pg')).toBe(1.84e9);
    expect(sizes.has('x')).toBe(false);
    expect(parseVolumeSizes('nope').size).toBe(0);
  });
});
