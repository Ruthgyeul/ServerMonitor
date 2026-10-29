import { describe, expect, it } from 'vitest';

import { failureReason, isImageId, reclaimedSpace } from '@/utils/collectors/controlActions';

describe('controlActions helpers', () => {
  it('validates image ids', () => {
    expect(isImageId('7d2f9a01c3e8')).toBe(true);
    expect(isImageId(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(isImageId('nginx:latest')).toBe(false);
    expect(isImageId('7d2f; rm -rf /')).toBe(false);
  });

  it('reads the reclaimed space from prune output', () => {
    expect(reclaimedSpace('Deleted Images:\nuntagged: x\n\nTotal reclaimed space: 1.31GB\n')).toBe('1.31GB');
    expect(reclaimedSpace('nothing')).toBeNull();
  });

  it('summarises failures without echoing command output', () => {
    expect(failureReason({ stderr: 'sudo: a password is required' })).toMatch(/sudoers/);
    expect(failureReason({ stderr: 'Error response from daemon: No such container: x' })).toBe('not found');
    expect(failureReason({ stderr: 'Failed to restart x.service: Access denied' })).toBe('permission denied');
    expect(failureReason({ killed: true, stderr: '' })).toBe('timed out');
    expect(failureReason(new Error('boom'))).toBe('command failed');
  });
});
