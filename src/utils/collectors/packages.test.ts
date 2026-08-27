import { describe, expect, it } from 'vitest';

import { parseAptCheck, parseAptSimulation } from '@/utils/collectors/packages';

describe('parseAptCheck', () => {
  it('parses "total;security"', () => {
    expect(parseAptCheck('5;2')).toEqual({ total: 5, security: 2 });
    expect(parseAptCheck('0;0')).toEqual({ total: 0, security: 0 });
  });

  it('returns null for unexpected output', () => {
    expect(parseAptCheck('not the format')).toBeNull();
  });
});

describe('parseAptSimulation', () => {
  it('counts Inst lines and the security subset', () => {
    const output = [
      'Inst libc6 [2.35-0ubuntu3.1] (2.35-0ubuntu3.4 Ubuntu:22.04/jammy-security [amd64])',
      'Inst vim [2:8.2] (2:8.2.1 Ubuntu:22.04/jammy-updates [amd64])',
      'Conf libc6 (2.35-0ubuntu3.4)'
    ].join('\n');
    expect(parseAptSimulation(output)).toEqual({ total: 2, security: 1 });
  });

  it('matches the pocket, not a package name containing "security"', () => {
    const output = [
      'Inst libsecurity1 [1.0] (1.1 Ubuntu:22.04/jammy-updates [amd64])', // name only, not a security update
      'Inst openssl [3.0] (3.0.2 Ubuntu:22.04/jammy-security [amd64])'
    ].join('\n');
    expect(parseAptSimulation(output)).toEqual({ total: 2, security: 1 });
  });

  it('returns zero on a fully patched host (no Inst lines)', () => {
    expect(parseAptSimulation('Reading package lists...\n0 upgraded, 0 newly installed.')).toEqual({
      total: 0,
      security: 0
    });
  });
});
