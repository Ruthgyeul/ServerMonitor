'use client';

import React, { useMemo, useState } from 'react';
import { Container } from 'lucide-react';

import { ContainerInspector } from '@/components/docker/ContainerInspector';
import { DiskUsagePanel } from '@/components/docker/DiskUsagePanel';
import { formatSize } from '@/components/docker/format';
import { ResourceTabs } from '@/components/docker/ResourceTabs';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { useShellActions } from '@/components/shell/ShellActions';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageBody } from '@/components/ui/PageBody';
import { Segmented } from '@/components/ui/Segmented';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { containerDot } from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { DockerContainerDetail, DockerDetails } from '@/types/system';

// Containers with live usage and a configuration inspector, plus images,
// volumes, networks and Docker's disk usage.

const DETAILS_URL = '/api/docker';
const POLL_MS = 15_000;
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_52px_52px_60px_90px] gap-3';

type Filter = 'all' | 'running' | 'stopped';
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' }
] as const;

const statusColor = (state: string) =>
  state === 'running'
    ? PALETTE.text3
    : state === 'restarting' || state === 'paused'
      ? PALETTE.warnFg
      : PALETTE.subtle;

function matches(container: DockerContainerDetail, filter: Filter, query: string): boolean {
  const running = container.state === 'running';
  if ((filter === 'running' && !running) || (filter === 'stopped' && running)) return false;
  const needle = query.trim().toLowerCase();
  return !needle || `${container.name} ${container.image}`.toLowerCase().includes(needle);
}

export default function DockerPage() {
  const details = usePolled<DockerDetails>(DETAILS_URL, POLL_MS);
  const { data } = useSystem();
  const now = useNow();
  const { openLogs } = useShellActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const live = useMemo(
    () => new Map((data?.docker.containers ?? []).map(container => [container.id, container])),
    [data]
  );

  if (details === null || now === null) {
    return (
      <PageBody>
        <p className="text-[12.5px] text-subtle">Loading Docker state…</p>
      </PageBody>
    );
  }
  if (!details.available) {
    return (
      <PageBody>
        <div className="rounded-[10px] border border-line bg-card">
          <EmptyState
            icon={Container}
            title="Docker not reachable"
            body="Install Docker or give this service access to the Docker socket to manage containers here."
          />
        </div>
      </PageBody>
    );
  }

  const containers = details.containers;
  const shown = containers.filter(container => matches(container, filter, query));
  const selected = containers.find(container => container.id === selectedId) ?? shown[0] ?? null;
  const running = containers.filter(container => container.state === 'running').length;
  const paused = containers.filter(container => container.state === 'paused').length;
  const stopped = containers.filter(container => container.state === 'exited').length;
  const imageBytes = details.images.reduce((sum, image) => sum + (image.sizeBytes ?? 0), 0);
  const volumeBytes = details.volumes.reduce((sum, volume) => sum + (volume.sizeBytes ?? 0), 0);
  const reclaimable = details.disk.reduce((sum, entry) => sum + entry.reclaimableBytes, 0);

  const stats = [
    { label: 'Running', value: `${running} / ${containers.length}`, color: PALETTE.text },
    { label: 'Paused · stopped', value: `${paused} · ${stopped}`, color: PALETTE.text },
    { label: 'Images', value: `${details.images.length} · ${formatSize(imageBytes)}`, color: PALETTE.text },
    {
      label: 'Volumes',
      value: `${details.volumes.length} · ${formatSize(volumeBytes)}`,
      color: PALETTE.text
    },
    {
      label: 'Reclaimable',
      value: formatSize(reclaimable),
      color: reclaimable ? PALETTE.warnFg : PALETTE.okFg
    }
  ];

  const logsButton = (container: DockerContainerDetail) => (
    <button
      onClick={() =>
        openLogs({ kind: 'container', name: container.name, title: `docker logs ${container.name}` })
      }
      className="rounded-[5px] border border-line-strong px-2.5 py-1 text-[11.5px] text-fg-2 hover:bg-white/5"
    >
      Logs
    </button>
  );

  return (
    <PageBody>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-card px-[18px] py-3.5"
          >
            <span className="text-xs text-muted">{stat.label}</span>
            <span className="font-mono text-xl font-medium" style={{ color: stat.color }}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[3_1_620px] overflow-hidden rounded-[10px] border border-line bg-card">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-white/5 px-[18px] py-3">
            <h2 className="mr-auto text-[13.5px] font-medium">Containers</h2>
            <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Container state" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Name or image…"
              aria-label="Filter containers"
              className="w-[180px] max-w-full rounded-md border border-line-strong bg-sidebar px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            />
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className={`${COLUMNS} px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint`}>
                <span>Name</span>
                <span>Image</span>
                <span>Status</span>
                <span className="text-right">CPU %</span>
                <span className="text-right">MEM %</span>
                <span className="text-right">KB/s</span>
                <span className="text-right">Ports</span>
              </div>
              {shown.length === 0 && (
                <p className="border-t border-line-soft p-[18px] text-[12.5px] text-subtle">
                  No containers match.
                </p>
              )}
              {shown.map(container => {
                const stats = live.get(container.id);
                const net =
                  stats && stats.netRxRate !== null && stats.netTxRate !== null
                    ? stats.netRxRate + stats.netTxRate
                    : null;
                const isSelected = selected?.id === container.id;
                return (
                  <button
                    key={container.id}
                    onClick={() => setSelectedId(container.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      `${COLUMNS} w-full items-center border-t border-l-2 border-t-line-soft py-[9px] pr-[18px] pl-4 text-left font-mono text-xs`,
                      isSelected ? 'border-l-accent bg-accent/6' : 'border-l-transparent hover:bg-white/3'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ background: containerDot(container.state) }}
                      />
                      <span className="truncate">{container.name}</span>
                    </span>
                    <span className="truncate text-muted">{container.image}</span>
                    <span className="truncate" style={{ color: statusColor(container.state) }}>
                      {container.status}
                    </span>
                    <span className="text-right">{stats?.cpuPercent?.toFixed(1) ?? '—'}</span>
                    <span className="text-right text-fg-3">{stats?.memPercent?.toFixed(1) ?? '—'}</span>
                    <span className="text-right text-subtle">{net === null ? '—' : net.toFixed(1)}</span>
                    <span className="truncate text-right text-muted">
                      {container.ports.map(port => port.split('→')[0].split(':').pop()).join(', ') || '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="min-w-0 flex-[1_1_320px] rounded-[10px] border border-line bg-card">
          {selected ? (
            <ContainerInspector
              container={selected}
              live={live.get(selected.id)}
              now={now}
              actions={logsButton(selected)}
            />
          ) : (
            <p className="px-[18px] py-5 text-[12.5px] text-subtle">Select a container to inspect it.</p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <ResourceTabs details={details} now={now} />
        <DiskUsagePanel disk={details.disk} />
      </div>
    </PageBody>
  );
}
