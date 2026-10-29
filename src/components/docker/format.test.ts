import { describe, expect, it } from 'vitest';

import { formatSize } from '@/components/docker/format';

describe('formatSize', () => {
  it('uses the largest decimal unit', () => {
    expect(formatSize(null)).toBe('—');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(48_200_000)).toBe('48 MB');
    expect(formatSize(1_840_000_000)).toBe('1.84 GB');
  });
});
