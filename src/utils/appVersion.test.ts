import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

import { readAppVersion } from '@/utils/appVersion';

describe('readAppVersion', () => {
  it('reads the version from package.json, or null when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'version-test-'));
    expect(readAppVersion(dir)).toBeNull();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '3.1.0' }));
    expect(readAppVersion(dir)).toBe('3.1.0');
  });
});
