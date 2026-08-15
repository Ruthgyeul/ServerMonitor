import { describe, expect, it } from 'vitest';

import { parseRunningEntities } from '@/utils/collectors/load';

// This parser only really runs on Linux with /proc. On a dev machine (macOS)
// the path is absent so it just falls back to null, so format validation can only happen here.
describe('parseRunningEntities', () => {
  it('reads the running-task count from the 4th field', () => {
    expect(parseRunningEntities('0.42 0.38 0.35 2/1234 5678\n')).toBe(2);
  });

  it('reads two or more digits', () => {
    expect(parseRunningEntities('12.00 9.51 8.20 137/2048 99\n')).toBe(137);
  });

  it('reads an idle value of 1 as-is', () => {
    // The reading process itself is always running, so the minimum is usually 1.
    expect(parseRunningEntities('0.00 0.00 0.00 1/128 42\n')).toBe(1);
  });

  it('does not mistake the total task count for the running count', () => {
    expect(parseRunningEntities('0.10 0.10 0.10 3/900 12')).not.toBe(900);
  });

  it('returns null on a different format', () => {
    expect(parseRunningEntities('')).toBeNull();
    expect(parseRunningEntities('nonsense')).toBeNull();
    // When the first three fields are missing — it must not grab the 4th by mistake.
    expect(parseRunningEntities('0.42 0.38 2/1234')).toBeNull();
  });
});
