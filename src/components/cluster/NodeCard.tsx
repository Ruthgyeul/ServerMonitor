import React from 'react';

import { linePath, padToWindow } from '@/components/charts/paths';
import { formatUptime, gb, shortProcessName, type ClusterNode } from '@/components/cluster/clusterTypes';
import { usageColor } from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { NetworkHistoryEntry } from '@/types/system';

// One cluster node: usage bars, a 30-second throughput sparkline and key facts.
// Offline nodes keep their frame and show the reason.

const BOX = { x: 0, y: 1, width: 200, height: 28 };
// Polls kept per node (one per second).
const WINDOW = 30;

export function NodeCard({
  node,
  history,
  onSelect
}: {
  node: ClusterNode;
  history: NetworkHistoryEntry[];
  onSelect: () => void;
}) {
  const { result } = node;
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-3.5 rounded-[10px] border bg-card px-[18px] py-4 text-left hover:border-white/18',
        result.ok ? 'border-line' : 'border-crit/25'
      )}
    >
      <div className="flex w-full items-center gap-2.5">
        <span className={cn('h-2 w-2 rounded-full', result.ok ? 'bg-ok' : 'bg-crit')} />
        <span className="flex-1 text-sm font-medium">{node.name}</span>
        <span className="font-mono text-[11px] text-subtle">{node.host}</span>
      </div>
      {!result.ok ? (
        <div className="flex w-full flex-col gap-1.5 rounded-lg border border-crit/20 bg-crit/6 p-3.5">
          <span className="text-[13px] text-crit-fg">Offline</span>
          <span className="font-mono text-[11.5px] text-muted">{result.error}</span>
        </div>
      ) : (
        <NodeBody data={result.data} history={history} />
      )}
    </button>
  );
}

function NodeBody({
  data,
  history
}: {
  data: Extract<ClusterNode['result'], { ok: true }>['data'];
  history: NetworkHistoryEntry[];
}) {
  const { cpu, memory, disk, network, uptime } = data;
  const bars: [string, number, string][] = [
    ['CPU', cpu.usage, `${cpu.cores}c`],
    ['RAM', memory.percentage, `${gb(memory.used)}/${gb(memory.total)}G`],
    ['DISK', disk.percentage, `${Math.round(disk.used)}/${Math.round(disk.total)}G`]
  ];
  const max = Math.max(0.1, ...history.map(point => Math.max(point.download, point.upload))) * 1.2;
  const top = data.processes.find(process => process.cpu > 0 || process.memory > 0);
  const temp = cpu.temperature === 'N/A' ? 'N/A' : `${cpu.temperature.toFixed(1)}°C`;

  return (
    <>
      <div className="flex w-full flex-col gap-2.5">
        {bars.map(([label, value, caption]) => (
          <div
            key={label}
            className="grid grid-cols-[44px_1fr_92px] items-center gap-2.5 font-mono text-[11.5px]"
          >
            <span className="text-muted">{label}</span>
            <div className="h-[5px] overflow-hidden rounded-[3px] bg-track">
              <div
                className="h-full"
                style={{ width: `${Math.min(100, value)}%`, background: usageColor(value) }}
              />
            </div>
            <span className="text-right">
              {value.toFixed(0)}% <span className="text-faint">{caption}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex w-full flex-col gap-1.5">
        <div className="flex justify-between text-[11.5px] text-subtle">
          <span>Network · 30s</span>
          <span className="font-mono">
            <span className="text-accent">↓ {network.download.toFixed(1)}</span>{' '}
            <span className="text-upload">↑ {network.upload.toFixed(1)}</span> KB/s
          </span>
        </div>
        <svg viewBox="0 0 200 30" preserveAspectRatio="none" className="block h-[30px] w-full">
          <path
            d={linePath(
              padToWindow(
                history.map(point => point.upload),
                WINDOW
              ),
              BOX,
              max
            )}
            fill="none"
            stroke={PALETTE.upload}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={linePath(
              padToWindow(
                history.map(point => point.download),
                WINDOW
              ),
              BOX,
              max
            )}
            fill="none"
            stroke={PALETTE.accent}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="flex w-full flex-wrap gap-x-4 gap-y-1.5 border-t border-white/5 pt-2.5 text-[11.5px] text-subtle">
        <span>
          temp <span className="font-mono text-fg-2">{temp}</span>
        </span>
        <span>
          up <span className="font-mono text-fg-2">{formatUptime(uptime)}</span>
        </span>
        <span>
          ping{' '}
          <span className="font-mono text-fg-2">
            {network.ping > 0 ? `${network.ping.toFixed(0)} ms` : '—'}
          </span>
        </span>
        {top && (
          <span>
            top <span className="font-mono text-fg-2">{shortProcessName(top.name)}</span>
          </span>
        )}
      </div>
    </>
  );
}
