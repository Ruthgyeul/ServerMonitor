import React from 'react';
import { Boxes } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DockerContainer } from '@/types/system';
import { DashboardData } from '@/utils/dashboardData';
import { formatRate } from '@/utils/format';

import { Card, Empty } from './shared';

// Keep the kiosk/column height budget: show the busiest few, note the rest.
const MAX_ROWS = 6;

// Container lifecycle → dot color. running is healthy; dead/restarting are
// trouble (red); paused/created/exited are quiescent (gray/amber).
function stateColor(state: string): string {
  switch (state) {
    case 'running':
      return 'bg-emerald-400';
    case 'paused':
    case 'restarting':
      return 'bg-amber-400';
    case 'dead':
      return 'bg-red-400';
    default: // exited / created / unknown
      return 'bg-gray-500';
  }
}

const ContainerRow: React.FC<{ container: DockerContainer }> = ({ container }) => {
  const net =
    container.netRxRate === null || container.netTxRate === null
      ? null
      : container.netRxRate + container.netTxRate;

  // The full image + status line is only useful on demand, so it rides the tooltip.
  const detail = `${container.image || container.id}${container.status ? ` · ${container.status}` : ''}`;

  return (
    <li className="t-body flex items-center justify-between gap-2">
      <span className="dash-tip flex min-w-0 items-center gap-1.5" tabIndex={-1} data-tip={detail}>
        <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', stateColor(container.state))} />
        <span className="block truncate text-gray-400">{container.name}</span>
      </span>
      <div className="flex shrink-0 gap-2 font-mono">
        <span className="w-[4ch] text-right text-amber-400">
          {container.cpuPercent === null ? '—' : container.cpuPercent.toFixed(0)}
        </span>
        <span className="w-[4ch] text-right text-sky-400">
          {container.memPercent === null ? '—' : container.memPercent.toFixed(0)}
        </span>
        <span className="w-[9ch] text-right text-gray-500">{net === null ? '—' : formatRate(net)}</span>
      </div>
    </li>
  );
};

// Hidden entirely on hosts without Docker (data.docker.available === false), so
// a plain server never shows an empty "no containers" card.
export const DockerCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const docker = data.docker;
  if (!docker.available) return null;

  const hidden = Math.max(0, docker.containers.length - MAX_ROWS);
  const netTotal = docker.netRxRate + docker.netTxRate;

  const summary = (
    <span className="flex shrink-0 items-center gap-2 font-mono">
      <span className="t-micro text-gray-500">
        <span className="text-emerald-400">{docker.running}</span>/{docker.total} up
      </span>
      <span className="t-micro whitespace-nowrap text-gray-400" title="aggregate container network">
        {formatRate(netTotal)}
      </span>
    </span>
  );

  return (
    <Card icon={Boxes} color="#38bdf8" title="DOCKER CONTAINERS" right={summary}>
      {docker.total === 0 && <Empty>no containers</Empty>}
      {docker.total > 0 && (
        <>
          <div className="t-micro mb-0.5 flex items-center justify-between text-gray-500">
            <span>Container</span>
            <div className="flex gap-2">
              <span className="w-[4ch] text-right text-amber-400/60">CPU</span>
              <span className="w-[4ch] text-right text-sky-400/60">MEM</span>
              <span className="w-[9ch] text-right">NET</span>
            </div>
          </div>
          <ul className="dash-rows">
            {docker.containers.slice(0, MAX_ROWS).map(container => (
              <ContainerRow key={container.id} container={container} />
            ))}
          </ul>
          {hidden > 0 && <p className="t-micro mt-1 text-right text-gray-500">+{hidden} more</p>}
        </>
      )}
    </Card>
  );
};
