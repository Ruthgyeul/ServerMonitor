import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// alertOverrides.ts holds its overrides in module scope, so it must be
// reimported per test, each with its own temp store file.
async function freshOverrides() {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'alert-overrides-test-'));
  process.env.DATA_DIR = dir;
  process.env.ALERT_OVERRIDES_FILE = join(dir, 'alert-overrides.json');
  return import('@/utils/collectors/alertOverrides');
}

describe('alert threshold overrides', () => {
  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.ALERT_OVERRIDES_FILE;
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.ALERT_OVERRIDES_FILE;
  });

  it('is unset for a key with no override', async () => {
    const { getOverride } = await freshOverrides();
    expect(getOverride('ALERT_CPU_ENTER')).toBeUndefined();
  });

  it('rejects an unknown key, never persisting it', async () => {
    const { isConfigurableThreshold } = await freshOverrides();
    expect(isConfigurableThreshold('ALERT_CPU_ENTER')).toBe(true);
    expect(isConfigurableThreshold('NOT_A_REAL_THRESHOLD')).toBe(false);
  });

  it('stores and returns an override', async () => {
    const { getOverride, setOverride } = await freshOverrides();
    setOverride('ALERT_CPU_ENTER', 95);
    expect(getOverride('ALERT_CPU_ENTER')).toBe(95);
  });

  it('clears an override back to unset', async () => {
    const { clearOverride, getOverride, setOverride } = await freshOverrides();
    setOverride('ALERT_CPU_ENTER', 95);
    clearOverride('ALERT_CPU_ENTER');
    expect(getOverride('ALERT_CPU_ENTER')).toBeUndefined();
  });

  it('lists every currently-set override', async () => {
    const { getAllOverrides, setOverride } = await freshOverrides();
    setOverride('ALERT_CPU_ENTER', 95);
    setOverride('ALERT_MEM_ENTER', 92);
    expect(getAllOverrides()).toEqual({ ALERT_CPU_ENTER: 95, ALERT_MEM_ENTER: 92 });
  });

  it('persists an override to disk immediately (no debounce, unlike the tick-driven stores)', async () => {
    const { setOverride } = await freshOverrides();
    setOverride('ALERT_CPU_ENTER', 95);

    const saved = JSON.parse(readFileSync(process.env.ALERT_OVERRIDES_FILE!, 'utf-8'));
    expect(saved.overrides).toEqual({ ALERT_CPU_ENTER: 95 });
  });

  it('reloads persisted overrides in a fresh module instance', async () => {
    const first = await freshOverrides();
    first.setOverride('ALERT_CPU_ENTER', 95);

    const dataDir = process.env.DATA_DIR!;
    const file = process.env.ALERT_OVERRIDES_FILE!;
    vi.resetModules();
    process.env.DATA_DIR = dataDir;
    process.env.ALERT_OVERRIDES_FILE = file;
    const second = await import('@/utils/collectors/alertOverrides');

    expect(second.getOverride('ALERT_CPU_ENTER')).toBe(95);
  });
});
