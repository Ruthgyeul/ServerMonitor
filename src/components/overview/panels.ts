// Which overview panels are shown. Saved per browser (localStorage) so a wall
// display and a laptop can show different subsets.

export const PANELS = [
  { id: 'kpis', label: 'Key metrics', description: 'CPU, memory, disk and network cards' },
  { id: 'network', label: 'Network throughput', description: 'Live chart with event markers' },
  { id: 'alertlog', label: 'Alert log', description: 'Latest alerts and system events' },
  { id: 'docker', label: 'Docker containers', description: 'Container status and usage' },
  { id: 'services', label: 'Services', description: 'systemd units and failures' },
  { id: 'cpu', label: 'CPU & load', description: 'Per-core usage and heatmaps' },
  { id: 'procs', label: 'Top processes', description: 'Busiest processes by CPU or memory' },
  { id: 'bandwidth', label: 'Bandwidth by day', description: 'Daily download and upload totals' },
  { id: 'capacity', label: 'Capacity forecast', description: 'When disk and memory fill up' },
  { id: 'hardware', label: 'Hardware', description: 'Temperature, fan, swap, disk I/O' },
  { id: 'ifaces', label: 'Interfaces', description: 'Network interfaces and link speed' },
  { id: 'security', label: 'Security', description: 'Firewall, SSH sessions, peers' }
] as const;

export type PanelId = (typeof PANELS)[number]['id'];
export type PanelPrefs = Record<PanelId, boolean>;

export const PRESETS = {
  all: { label: 'All', panels: null },
  essentials: { label: 'Essentials', panels: ['kpis', 'network', 'alertlog', 'docker', 'services'] },
  minimal: { label: 'Minimal', panels: ['kpis', 'alertlog'] }
} as const satisfies Record<string, { label: string; panels: readonly PanelId[] | null }>;

export type PresetId = keyof typeof PRESETS;

export const PANELS_STORAGE_KEY = 'sm-overview-panels';

function allShown(): PanelPrefs {
  return Object.fromEntries(PANELS.map(panel => [panel.id, true])) as PanelPrefs;
}

// Saved JSON → full prefs. Unknown keys and non-boolean values are ignored, and
// panels added after the prefs were saved default to shown.
export function parsePanelPrefs(raw: string | null): PanelPrefs {
  const prefs = allShown();
  if (!raw) return prefs;
  try {
    const saved: unknown = JSON.parse(raw);
    if (saved && typeof saved === 'object') {
      for (const panel of PANELS) {
        const value = (saved as Record<string, unknown>)[panel.id];
        if (typeof value === 'boolean') prefs[panel.id] = value;
      }
    }
  } catch {
    /* corrupt — fall back to everything shown */
  }
  return prefs;
}

export function presetPrefs(preset: PresetId): PanelPrefs {
  const only: readonly PanelId[] | null = PRESETS[preset].panels;
  return Object.fromEntries(
    PANELS.map(panel => [panel.id, only === null || only.includes(panel.id)])
  ) as PanelPrefs;
}

export function shownCount(prefs: PanelPrefs): number {
  return PANELS.filter(panel => prefs[panel.id]).length;
}

// Footer line under the panels: "Showing all panels" / "3 panels hidden".
export function hiddenSummary(prefs: PanelPrefs): string {
  const shown = shownCount(prefs);
  const hidden = PANELS.length - shown;
  if (hidden === 0) return 'Showing all panels';
  if (shown === 0) return 'All panels are hidden';
  return `${hidden} panel${hidden > 1 ? 's' : ''} hidden`;
}
