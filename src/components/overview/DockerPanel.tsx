import React from 'react';
import Link from 'next/link';
import { Container } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { containerDot } from '@/lib/statusColors';
import type { DockerInfo } from '@/types/system';
import { formatRate } from '@/utils/format';

// Container roster with live usage. Running first, then busiest CPU (the
// collector already sorts this way).

const COLUMNS = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_56px_56px_76px] gap-3';
const pct = (value: number | null) => (value === null ? '—' : value.toFixed(1));

export function DockerPanel({ docker }: { docker: DockerInfo }) {
  return (
    <Panel
      className="flex-[2_1_560px]"
      title="Docker containers"
      actions={
        <>
          {docker.available && (
            <span className="font-mono text-xs text-muted">
              <span className="text-ok-fg">{docker.running}</span> / {docker.total} up ·{' '}
              {formatRate(docker.netRxRate + docker.netTxRate)}
            </span>
          )}
          <Link href="/docker" className="text-xs">
            Manage
          </Link>
        </>
      }
    >
      {!docker.available || docker.containers.length === 0 ? (
        <EmptyState
          icon={Container}
          title={docker.available ? 'No containers' : 'Docker not detected'}
          body={
            docker.available
              ? 'Containers will appear here once they are created.'
              : 'Install Docker or give the monitor read access to /var/run/docker.sock.'
          }
        />
      ) : (
        <>
          <div className={`${COLUMNS} px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint`}>
            <span>Container</span>
            <span>Status</span>
            <span className="text-right">CPU %</span>
            <span className="text-right">MEM %</span>
            <span className="text-right">NET</span>
          </div>
          {docker.containers.map(container => {
            const net =
              container.netRxRate === null || container.netTxRate === null
                ? null
                : container.netRxRate + container.netTxRate;
            return (
              <div
                key={container.id}
                className={`${COLUMNS} items-center border-t border-line-soft px-[18px] py-2 font-mono text-xs`}
              >
                <span title={container.image} className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: containerDot(container.state) }}
                  />
                  <span className="truncate text-fg-2">{container.name}</span>
                </span>
                <span className="truncate text-subtle">{container.status}</span>
                <span className="text-right">{pct(container.cpuPercent)}</span>
                <span className="text-right text-fg-3">{pct(container.memPercent)}</span>
                <span className="text-right text-subtle">{net === null ? '—' : formatRate(net)}</span>
              </div>
            );
          })}
        </>
      )}
    </Panel>
  );
}
