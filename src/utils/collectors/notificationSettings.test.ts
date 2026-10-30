import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, mergeSettings } from '@/utils/collectors/notificationSettings';

describe('DEFAULT_SETTINGS', () => {
  it('sends critical and warning alerts only, as in the design', () => {
    expect(DEFAULT_SETTINGS.levels).toEqual({ critical: true, warning: true, info: false, ok: false });
  });
});

describe('mergeSettings', () => {
  it('applies known boolean fields only', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      webhook: false,
      levels: { info: true, ok: 'no', bogus: true },
      extra: 1
    });
    expect(next).toEqual({
      webhook: false,
      levels: { critical: true, warning: true, info: true, ok: false }
    });
  });

  it('ignores a non-object patch and never mutates the input', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
    mergeSettings(DEFAULT_SETTINGS, { levels: { critical: false } });
    expect(DEFAULT_SETTINGS.levels.critical).toBe(true);
  });
});
