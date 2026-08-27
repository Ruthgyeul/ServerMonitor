import { describe, expect, it } from 'vitest';

import { timingSafeEqual } from '@/utils/timingSafeEqual';

describe('timingSafeEqual', () => {
  it('is true for identical strings', () => {
    expect(timingSafeEqual('secret-token', 'secret-token')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('is false for different values or lengths', () => {
    expect(timingSafeEqual('secret-token', 'secret-tokeN')).toBe(false);
    expect(timingSafeEqual('short', 'longer-value')).toBe(false);
    expect(timingSafeEqual('a', '')).toBe(false);
  });

  it('handles multi-byte characters', () => {
    expect(timingSafeEqual('토큰', '토큰')).toBe(true);
    expect(timingSafeEqual('토큰', '토근')).toBe(false);
  });
});
