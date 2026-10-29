'use client';

import React, { useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';

import { matchesFilter, sortUnits, unitColors, type UnitFilter } from '@/components/services/unitState';
import { useShellActions } from '@/components/shell/ShellActions';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageBody } from '@/components/ui/PageBody';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { ServiceUnitList } from '@/types/system';
import { formatAge } from '@/utils/timeFormat';

// Every loaded systemd service: counts, a running/stopped filter, search and
// per-unit logs.

const UNITS_URL = '/api/services';
const POLL_MS = 10_000;
const COLUMNS = 'grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_90px_90px_90px_80px] gap-3';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped / failed' }
] as const;

export default function ServicesPage() {
  const list = usePolled<ServiceUnitList>(UNITS_URL, POLL_MS);
  const now = useNow();
  const { openLogs } = useShellActions();
  const [filter, setFilter] = useState<UnitFilter>('all');
  const [query, setQuery] = useState('');

  const units = useMemo(() => sortUnits(list?.units ?? []), [list]);
  const shown = units.filter(unit => matchesFilter(unit, filter, query));
  const failed = units.filter(unit => unit.active === 'failed').length;
  const transitioning = units.filter(
    unit => unit.active === 'activating' || unit.active === 'deactivating'
  ).length;
  const active = units.filter(unit => unit.active === 'active').length;

  const stats = [
    { label: 'Total units', value: String(units.length), color: PALETTE.text },
    {
      label: 'Restarting',
      value: String(transitioning),
      color: transitioning ? PALETTE.warnFg : PALETTE.text
    },
    { label: 'Units active', value: `${active} / ${units.length}`, color: PALETTE.text },
    { label: 'Failed units', value: String(failed), color: failed ? PALETTE.critFg : PALETTE.okFg }
  ];

  return (
    <PageBody>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-card px-[18px] py-3.5"
          >
            <span className="text-xs text-muted">{stat.label}</span>
            <span className="font-mono text-[22px] font-medium" style={{ color: stat.color }}>
              {list === null ? '—' : stat.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Unit state" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Filter units…"
          aria-label="Filter units"
          className="ml-auto w-60 max-w-full rounded-[7px] border border-line-strong bg-sidebar px-2.5 py-[7px] text-[12.5px] outline-none focus:border-accent"
        />
      </div>

      <Panel
        className="overflow-hidden"
        title="systemd services"
        actions={<span className="font-mono text-xs text-muted">systemctl list-units --type=service</span>}
      >
        {list !== null && !list.available ? (
          <EmptyState
            icon={Boxes}
            title="systemd not available"
            body="systemctl can't be run on this host or inside this container."
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className={`${COLUMNS} px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint`}>
                <span>Unit</span>
                <span>Description</span>
                <span>Active</span>
                <span>Sub</span>
                <span>Since</span>
                <span className="text-right">Actions</span>
              </div>
              {list === null && (
                <p className="border-t border-line-soft p-[18px] text-[12.5px] text-subtle">Loading…</p>
              )}
              {list !== null && shown.length === 0 && (
                <p className="border-t border-line-soft p-[18px] text-[12.5px] text-subtle">
                  No units match.
                </p>
              )}
              {shown.map(unit => {
                const colors = unitColors(unit);
                return (
                  <div
                    key={unit.name}
                    className={cn(
                      `${COLUMNS} items-center border-t border-line-soft px-[18px] py-[9px] text-xs`,
                      unit.active === 'failed' && 'bg-crit/6'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-mono">
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ background: colors.dot }}
                      />
                      <span className="truncate">{unit.name}</span>
                    </span>
                    <span className="truncate text-muted">{unit.description}</span>
                    <span className="font-mono" style={{ color: colors.text }}>
                      {unit.active}
                    </span>
                    <span className="font-mono text-fg-3">{unit.sub}</span>
                    <span className="font-mono text-subtle">
                      {unit.since && now !== null
                        ? `${formatAge(now - new Date(unit.since).getTime())} ago`
                        : '—'}
                    </span>
                    <span className="flex justify-end gap-1.5">
                      <button
                        onClick={() =>
                          openLogs({ kind: 'unit', name: unit.name, title: `journalctl -u ${unit.name}` })
                        }
                        className="rounded-[5px] border border-line-strong px-[9px] py-[3px] text-[11.5px] text-fg-3 hover:bg-white/5"
                      >
                        Logs
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>
    </PageBody>
  );
}
