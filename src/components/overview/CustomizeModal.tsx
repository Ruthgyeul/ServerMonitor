'use client';

import React from 'react';

import { PANELS, PRESETS, shownCount, type PresetId } from '@/components/overview/panels';
import { usePanelPrefs } from '@/components/overview/usePanelPrefs';
import { Modal } from '@/components/ui/Modal';
import { Toggle } from '@/components/ui/Toggle';

// "Customize overview": per-panel switches plus presets. Changes apply live.
export function CustomizeModal({ onClose }: { onClose: () => void }) {
  const { prefs, toggle, applyPreset } = usePanelPrefs();

  return (
    <Modal
      title="Customize overview"
      onClose={onClose}
      className="flex max-h-[88vh] max-w-[480px] flex-col"
      aside={
        <span className="font-mono text-[11.5px] text-subtle">
          {shownCount(prefs)} of {PANELS.length} shown
        </span>
      }
    >
      <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
        <span className="mr-1 self-center text-xs text-subtle">Presets</span>
        {(Object.keys(PRESETS) as PresetId[]).map(preset => (
          <button
            key={preset}
            onClick={() => applyPreset(preset)}
            className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-fg-2 hover:bg-white/5"
          >
            {PRESETS[preset].label}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto">
        {PANELS.map(panel => (
          <div key={panel.id} className="flex items-center gap-3.5 border-b border-line-soft px-5 py-[11px]">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px]">{panel.label}</span>
              <span className="text-[11.5px] text-subtle">{panel.description}</span>
            </div>
            <Toggle on={prefs[panel.id]} onChange={() => toggle(panel.id)} label={`Toggle ${panel.label}`} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5 px-5 py-3">
        <span className="flex-1 text-xs text-subtle">Saved in this browser</span>
        <button
          onClick={onClose}
          className="rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-canvas"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
