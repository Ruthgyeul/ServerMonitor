import { describe, expect, it } from 'vitest';

import {
  isServiceUnitName,
  parseActiveSince,
  parseFailedUnits,
  parseUnitList
} from '@/utils/collectors/services';

describe('parseFailedUnits', () => {
  it('extracts failed .service unit names', () => {
    const output = [
      'nginx.service      loaded failed failed The nginx web server',
      'postgresql.service loaded failed failed PostgreSQL database'
    ].join('\n');
    expect(parseFailedUnits(output)).toEqual(['nginx.service', 'postgresql.service']);
  });

  it('returns empty for no failures', () => {
    expect(parseFailedUnits('')).toEqual([]);
  });

  it('ignores a summary footer and non-service rows', () => {
    const output = 'docker.socket loaded failed failed\n1 loaded units listed.';
    expect(parseFailedUnits(output)).toEqual([]);
  });
});

describe('parseUnitList', () => {
  it('reads unit, load, active, sub and the multi-word description', () => {
    const output = [
      'ssh.service              loaded    active   running OpenBSD Secure Shell server',
      'fail2ban.service         loaded    failed   failed  Fail2Ban Service',
      'ghost.service            not-found inactive dead    ghost.service',
      'ufw.service              loaded    active   exited  Uncomplicated firewall'
    ].join('\n');
    expect(parseUnitList(output)).toEqual([
      {
        name: 'ssh.service',
        load: 'loaded',
        active: 'active',
        sub: 'running',
        description: 'OpenBSD Secure Shell server'
      },
      {
        name: 'fail2ban.service',
        load: 'loaded',
        active: 'failed',
        sub: 'failed',
        description: 'Fail2Ban Service'
      },
      {
        name: 'ufw.service',
        load: 'loaded',
        active: 'active',
        sub: 'exited',
        description: 'Uncomplicated firewall'
      }
    ]);
  });

  it('skips rows that are not service units', () => {
    expect(parseUnitList('docker.socket loaded active running Docker Socket')).toEqual([]);
  });
});

describe('parseActiveSince', () => {
  it('maps each unit to the time it became active', () => {
    const output =
      'Id=ssh.service\nActiveEnterTimestamp=@1730202930\n\nId=never.service\nActiveEnterTimestamp=\n';
    const since = parseActiveSince(output);
    expect(since.get('ssh.service')).toBe(new Date(1730202930 * 1000).toISOString());
    expect(since.has('never.service')).toBe(false);
  });
});

describe('isServiceUnitName', () => {
  it('accepts systemd names and rejects shell syntax', () => {
    expect(isServiceUnitName('getty@tty1.service')).toBe(true);
    expect(isServiceUnitName('systemd-fsck@dev-disk-by\\x2duuid.service')).toBe(true);
    expect(isServiceUnitName('nginx.service; rm -rf /')).toBe(false);
    expect(isServiceUnitName('nginx')).toBe(false);
  });
});
