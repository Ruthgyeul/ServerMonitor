import { PALETTE } from '@/lib/theme';
import type { ServiceUnit } from '@/types/system';

// How a unit's state reads on the Services page.

export type UnitFilter = 'all' | 'running' | 'stopped';

export function unitColors(unit: Pick<ServiceUnit, 'active'>): { dot: string; text: string } {
  if (unit.active === 'failed') return { dot: PALETTE.crit, text: PALETTE.critFg };
  if (unit.active === 'activating' || unit.active === 'deactivating' || unit.active === 'reloading') {
    return { dot: PALETTE.warn, text: PALETTE.warnFg };
  }
  if (unit.active === 'active') return { dot: PALETTE.ok, text: PALETTE.okFg };
  return { dot: PALETTE.faint, text: PALETTE.subtle };
}

// "Running" means active; everything else (inactive, failed, transitional) is
// under "Stopped / failed".
export function matchesFilter(unit: ServiceUnit, filter: UnitFilter, query: string): boolean {
  const running = unit.active === 'active';
  if (filter === 'running' && !running) return false;
  if (filter === 'stopped' && running) return false;
  const needle = query.trim().toLowerCase();
  return !needle || `${unit.name} ${unit.description}`.toLowerCase().includes(needle);
}

// Failed first, then transitional, then active, then the rest; by name within.
export function sortUnits(units: ServiceUnit[]): ServiceUnit[] {
  const rank = (unit: ServiceUnit) =>
    unit.active === 'failed' ? 0 : unit.active === 'active' ? 2 : unit.active === 'inactive' ? 3 : 1;
  return [...units].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
