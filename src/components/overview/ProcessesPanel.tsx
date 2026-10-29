'use client';

import React, { useState } from 'react';

import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import type { DashboardData } from '@/utils/dashboardData';

// Busiest processes, sortable by CPU or memory. The sorted-by column is bright.

const MAX_ROWS = 6;
const SORTS = [
  { value: 'cpu', label: 'CPU' },
  { value: 'mem', label: 'MEM' }
] as const;

export function ProcessesPanel({ data }: { data: DashboardData }) {
  const [sort, setSort] = useState<'cpu' | 'mem'>('cpu');
  const source = sort === 'mem' ? data.topProcessesByMemory : data.processes;
  const rows = source.filter(process => process.cpu > 0 || process.memory > 0).slice(0, MAX_ROWS);
  const { total, zombie } = data.processSummary;

  return (
    <Panel
      className="flex-[1_1_320px]"
      title="Top processes"
      headerClassName="gap-x-2.5"
      actions={
        <>
          <span className="font-mono text-[11px] text-subtle">
            {total} total{zombie > 0 && <span className="text-warn-fg"> · {zombie} zombie</span>}
          </span>
          <Segmented options={SORTS} value={sort} onChange={setSort} label="Sort processes" />
        </>
      }
    >
      <div className="grid grid-cols-[1fr_52px_52px] gap-2.5 px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint">
        <span>Name</span>
        <span className="text-right">CPU %</span>
        <span className="text-right">MEM %</span>
      </div>
      <ul>
        {rows.map(process => (
          <li
            key={process.id}
            className="grid grid-cols-[1fr_52px_52px] items-center gap-2.5 border-t border-line-soft px-[18px] py-2 font-mono text-xs"
          >
            <span className="truncate text-fg-2">{process.name}</span>
            <span className={sort === 'cpu' ? 'text-right text-fg' : 'text-right text-fg-3'}>
              {process.cpu.toFixed(1)}
            </span>
            <span className={sort === 'mem' ? 'text-right text-fg' : 'text-right text-fg-3'}>
              {process.memory.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
