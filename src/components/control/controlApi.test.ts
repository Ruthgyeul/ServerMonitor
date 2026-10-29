import { describe, expect, it } from 'vitest';

import { permissionFor } from '@/components/control/controlApi';
import type { ControlStatus } from '@/utils/control';

const on: ControlStatus = { enabled: true, reason: null, containers: ['nginx'], units: '*', prune: false };

describe('permissionFor', () => {
  it('passes through the gate reason when controls are off', () => {
    const off = { ...on, enabled: false, reason: 'Set CONTROL_ENABLED=true to use control actions' };
    expect(permissionFor(off, 'container', 'nginx')).toEqual({ allowed: false, reason: off.reason });
    expect(permissionFor(null, 'unit', 'x').allowed).toBe(false);
  });

  it('checks allowlists and the prune switch', () => {
    expect(permissionFor(on, 'container', 'nginx').allowed).toBe(true);
    expect(permissionFor(on, 'container', 'postgres').reason).toMatch(/CONTROL_ALLOWLIST_CONTAINERS/);
    expect(permissionFor(on, 'unit', 'anything.service').allowed).toBe(true);
    expect(permissionFor(on, 'prune').reason).toMatch(/CONTROL_ALLOW_PRUNE/);
  });
});
