import { describe, expect, it } from 'vitest';

import { parseFailedUnits } from '@/utils/collectors/services';

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
