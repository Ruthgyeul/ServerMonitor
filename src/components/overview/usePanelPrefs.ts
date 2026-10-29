'use client';

import { useCallback, useMemo } from 'react';

import {
  PANELS_STORAGE_KEY,
  parsePanelPrefs,
  presetPrefs,
  type PanelId,
  type PanelPrefs,
  type PresetId
} from '@/components/overview/panels';
import { useStoredString } from '@/hooks/useStoredString';

// Overview panel visibility, shared by the page and the header's Customize
// dialog through localStorage (both re-render on change).
export function usePanelPrefs() {
  const [raw, setRaw] = useStoredString(PANELS_STORAGE_KEY);
  const prefs = useMemo(() => parsePanelPrefs(raw), [raw]);

  const save = useCallback((next: PanelPrefs) => setRaw(JSON.stringify(next)), [setRaw]);
  const toggle = useCallback((id: PanelId) => save({ ...prefs, [id]: !prefs[id] }), [prefs, save]);
  const applyPreset = useCallback((preset: PresetId) => save(presetPrefs(preset)), [save]);

  return { prefs, toggle, applyPreset };
}
