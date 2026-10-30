'use client';

import React from 'react';

import {
  formatUptime,
  gb,
  offlineReason,
  pingText,
  shortProcessName,
  type ClusterNode
} from '@/components/cluster/clusterTypes';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

// Detail dialog for one node: the full fact sheet (always the same nine rows,
// "—" where the node doesn't report a value) and its busiest processes.

const MAX_PROCESSES = 4;

type NodeData = Extract<ClusterNode['result'], { ok: true }>['data'];

function factRows(node: ClusterNode, d: NodeData): [string, string][] {
  return [
    ['CPU', `${d.cpu.usage.toFixed(1)}% · ${d.cpu.cores} cores`],
    ['Memory', `${d.memory.percentage.toFixed(1)}% · ${gb(d.memory.used)}/${gb(d.memory.total)}G`],
    ['Disk', `${d.disk.percentage.toFixed(1)}% · ${Math.round(d.disk.used)}/${Math.round(d.disk.total)}G`],
    ['Temp', d.cpu.temperature === 'N/A' ? '—' : `${d.cpu.temperature.toFixed(1)}°C`],
    [
      'Load',
      d.load ? `${d.load.avg1.toFixed(2)} / ${d.load.avg5.toFixed(2)} / ${d.load.avg15.toFixed(2)}` : '—'
    ],
    ['Swap', d.swap ? `${d.swap.percentage.toFixed(1)}%` : '—'],
    ['Uptime', formatUptime(d.uptime)],
    ['Ping', pingText(node)],
    ['OS', d.host ? `${d.host.os} · ${d.host.kernel.split('-')[0]}` : '—']
  ];
}

export function NodeModal({
  node,
  now,
  onClose
}: {
  node: ClusterNode;
  now: number | null;
  onClose: () => void;
}) {
  const { result } = node;
  const rows = result.ok ? factRows(node, result.data) : [];
  const processes = result.ok
    ? result.data.processes.filter(process => process.cpu > 0 || process.memory > 0).slice(0, MAX_PROCESSES)
    : [];

  return (
    <Modal
      onClose={onClose}
      className="max-h-[85vh] max-w-[540px] overflow-auto"
      title={
        <span className="flex items-center gap-2.5">
          <span className={cn('h-2 w-2 rounded-full', result.ok ? 'bg-ok' : 'bg-crit')} />
          {node.name}
          <span className="ml-1.5 font-mono text-[11.5px] font-normal text-subtle">{node.host}</span>
        </span>
      }
    >
      {!result.ok ? (
        <p className="px-5 py-[18px] font-mono text-[12.5px] text-crit-fg">{offlineReason(node, now)}</p>
      ) : (
        <>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-6 px-5 pt-2 pb-1">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-2.5 border-b border-white/5 py-[9px] text-[12.5px]"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-mono">{value}</dd>
              </div>
            ))}
          </dl>
          {processes.length > 0 && (
            <div className="px-5 pt-3.5 pb-[18px]">
              <span className="text-[11.5px] text-subtle">Top processes</span>
              <ul className="mt-2 flex flex-col gap-1.5">
                {processes.map(process => (
                  <li key={process.id} className="flex justify-between gap-2.5 font-mono text-xs">
                    <span className="text-fg-2">{shortProcessName(process.name)}</span>
                    <span className="text-subtle">
                      {process.cpu.toFixed(0)}% · {process.memory.toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
