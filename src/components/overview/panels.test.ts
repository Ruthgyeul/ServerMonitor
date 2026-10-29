import { describe, expect, it } from 'vitest';

import {
  PANELS,
  hiddenSummary,
  parsePanelPrefs,
  presetPrefs,
  shownCount
} from '@/components/overview/panels';

describe('parsePanelPrefs', () => {
  it('shows everything when nothing is saved or the value is corrupt', () => {
    expect(shownCount(parsePanelPrefs(null))).toBe(PANELS.length);
    expect(shownCount(parsePanelPrefs('{not json'))).toBe(PANELS.length);
  });

  it('applies saved booleans and ignores junk', () => {
    const prefs = parsePanelPrefs(JSON.stringify({ docker: false, cpu: 'no', bogus: false }));
    expect(prefs.docker).toBe(false);
    expect(prefs.cpu).toBe(true);
    expect(shownCount(prefs)).toBe(PANELS.length - 1);
  });
});

describe('presets', () => {
  it('limits the minimal preset to KPIs and the alert log', () => {
    const prefs = presetPrefs('minimal');
    expect(PANELS.filter(panel => prefs[panel.id]).map(panel => panel.id)).toEqual(['kpis', 'alertlog']);
  });

  it('shows all panels for the all preset', () => {
    expect(shownCount(presetPrefs('all'))).toBe(PANELS.length);
  });
});

describe('hiddenSummary', () => {
  it('describes how many panels are hidden', () => {
    expect(hiddenSummary(presetPrefs('all'))).toBe('Showing all panels');
    expect(hiddenSummary(presetPrefs('minimal'))).toBe(`${PANELS.length - 2} panels hidden`);
    expect(hiddenSummary(parsePanelPrefs(JSON.stringify({ kpis: false })))).toBe('1 panel hidden');
    const none = Object.fromEntries(PANELS.map(panel => [panel.id, false]));
    expect(hiddenSummary(parsePanelPrefs(JSON.stringify(none)))).toBe('All panels are hidden');
  });
});
