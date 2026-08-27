import { afterEach, describe, expect, it } from 'vitest';

import { clearMute, inQuietHours, isMuted, muteAll, muteKey } from '@/utils/collectors/alertMute';

afterEach(() => clearMute());

describe('inQuietHours', () => {
  it('handles a same-day window', () => {
    const spec = '09:00-17:00';
    expect(inQuietHours(new Date(2026, 0, 2, 12, 0), spec)).toBe(true);
    expect(inQuietHours(new Date(2026, 0, 2, 8, 0), spec)).toBe(false);
    expect(inQuietHours(new Date(2026, 0, 2, 17, 0), spec)).toBe(false); // end exclusive
  });

  it('wraps past midnight', () => {
    const spec = '22:00-07:00';
    expect(inQuietHours(new Date(2026, 0, 2, 23, 30), spec)).toBe(true);
    expect(inQuietHours(new Date(2026, 0, 2, 3, 0), spec)).toBe(true);
    expect(inQuietHours(new Date(2026, 0, 2, 12, 0), spec)).toBe(false);
  });

  it('returns false for no/invalid spec', () => {
    expect(inQuietHours(new Date(), null)).toBe(false);
    expect(inQuietHours(new Date(), 'nonsense')).toBe(false);
  });
});

describe('mute state', () => {
  it('mutes globally for a duration', () => {
    const at = 1_000_000;
    muteAll(10, at);
    expect(isMuted(null, at + 5 * 60_000)).toBe(true);
    expect(isMuted('cpu', at + 5 * 60_000)).toBe(true);
    expect(isMuted(null, at + 11 * 60_000)).toBe(false);
  });

  it('mutes a single key without affecting others', () => {
    const at = 1_000_000;
    muteKey('cpu', 10, at);
    expect(isMuted('cpu', at + 60_000)).toBe(true);
    expect(isMuted('memory', at + 60_000)).toBe(false);
    expect(isMuted(null, at + 60_000)).toBe(false);
  });

  it('clearMute lifts everything', () => {
    const at = 1_000_000;
    muteAll(10, at);
    clearMute();
    expect(isMuted(null, at + 60_000)).toBe(false);
  });
});
