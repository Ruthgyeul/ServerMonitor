import { describe, expect, it } from 'vitest';

import { matchesFilter, sortUnits, unitColors } from '@/components/services/unitState';
import { PALETTE } from '@/lib/theme';
import type { ServiceUnit } from '@/types/system';

const unit = (name: string, active: string, description = ''): ServiceUnit => ({
  name,
  description,
  load: 'loaded',
  active,
  sub: active === 'active' ? 'running' : 'dead',
  since: null
});

describe('matchesFilter', () => {
  it('splits running from stopped or failed and searches name and description', () => {
    const ssh = unit('ssh.service', 'active', 'OpenBSD Secure Shell');
    const f2b = unit('fail2ban.service', 'failed');
    expect(matchesFilter(ssh, 'running', '')).toBe(true);
    expect(matchesFilter(f2b, 'running', '')).toBe(false);
    expect(matchesFilter(f2b, 'stopped', '')).toBe(true);
    expect(matchesFilter(ssh, 'all', 'secure')).toBe(true);
    expect(matchesFilter(ssh, 'all', 'nginx')).toBe(false);
  });
});

describe('sortUnits', () => {
  it('puts failed units first and inactive ones last', () => {
    const sorted = sortUnits([
      unit('b.service', 'inactive'),
      unit('a.service', 'active'),
      unit('z.service', 'failed'),
      unit('c.service', 'activating')
    ]);
    expect(sorted.map(u => u.name)).toEqual(['z.service', 'c.service', 'a.service', 'b.service']);
  });
});

describe('unitColors', () => {
  it('maps states to status colors', () => {
    expect(unitColors({ active: 'failed' }).dot).toBe(PALETTE.crit);
    expect(unitColors({ active: 'activating' }).dot).toBe(PALETTE.warn);
    expect(unitColors({ active: 'active' }).dot).toBe(PALETTE.ok);
    expect(unitColors({ active: 'inactive' }).dot).toBe(PALETTE.faint);
  });
});
