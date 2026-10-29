'use client';

import React from 'react';

import { formatUptime, gb, shortProcessName, type ClusterNode } from '@/components/cluster/clusterTypes';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

// Detail dialog for one node: the full fact sheet and its busiest processes.

const MAX_PROCESSES = 6;

export function NodeModal({ node, onClose }: { node: ClusterNode; onClose: () => void }) {
  const { result } = node;
  const rows: [string, string][] = [];
  if (result.ok) {
    const d = result.data;
    rows.push(['CPU', `${d.cpu.usage.toFixed(1)}% · ${d.cpu.cores} cores`]);
    rows.push(['Memory', `${d.memory.percentage.toFixed(1)}% · ${gb(d.memory.used)}/${gb(d.memory.total)}G`]);
    rows.push([
      'Disk',
      `${d.disk.percentage.toFixed(1)}% · ${Math.round(d.disk.used)}/${Math.round(d.disk.total)}G`
    ]);
    rows.push(['Temp', d.cpu.temperature === 'N/A' ? 'N/A' : `${d.cpu.temperature.toFixed(1)}°C`]);
    if (d.load)
      rows.push([
        'Load',
        `${d.load.avg1.toFixed(2)} / ${d.load.avg5.toFixed(2)} / ${d.load.avg15.toFixed(2)}`
      ]);
    if (d.swap) rows.push(['Swap', `${d.swap.percentage.toFixed(1)}%`]);
    rows.push(['Uptime', formatUptime(d.uptime)]);
    rows.push(['Ping', d.network.ping > 0 ? `${d.network.ping.toFixed(0)} ms` : '—']);
    if (d.host) rows.push(['OS', `${d.host.os} · ${d.host.kernel.split('-')[0]}`]);
  }
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
        <p className="px-5 py-[18px] font-mono text-[12.5px] text-crit-fg">{result.error}</p>
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
                      {process.cpu.toFixed(1)}% · {process.memory.toFixed(1)}%
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
