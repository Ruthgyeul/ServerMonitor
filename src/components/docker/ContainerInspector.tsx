import React from 'react';

import { containerStatus } from '@/components/docker/format';
import { containerDot } from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';
import type { DockerContainer, DockerContainerDetail } from '@/types/system';
import { formatAge } from '@/utils/timeFormat';

// Right-hand panel of the Docker page: one container's configuration.

const HEALTH_COLOR: Record<string, string> = {
  healthy: PALETTE.okFg,
  unhealthy: PALETTE.critFg,
  starting: PALETTE.warnFg
};

interface ContainerInspectorProps {
  container: DockerContainerDetail;
  live: DockerContainer | undefined;
  now: number;
  actions: React.ReactNode;
}

// A health check only means something while the container runs: a stopped
// container's last "healthy" reads grey, not green.
function healthColor(container: DockerContainerDetail): string {
  if (!container.health || container.state !== 'running') return PALETTE.subtle;
  return HEALTH_COLOR[container.health] ?? PALETTE.subtle;
}

export function ContainerInspector({ container, live, now, actions }: ContainerInspectorProps) {
  const meta: [string, string][] = [
    ['Container ID', container.id],
    [
      'Created',
      container.createdAt ? `${formatAge(now - new Date(container.createdAt).getTime())} ago` : '—'
    ],
    ['Restart policy', container.restartPolicy ?? '—'],
    ['Memory limit', container.memLimitMb === null ? 'unlimited' : `${container.memLimitMb} MiB`],
    ['Command', container.command ?? '—'],
    [
      'CPU / MEM',
      live && container.state === 'running'
        ? `${(live.cpuPercent ?? 0).toFixed(1)}% / ${(live.memPercent ?? 0).toFixed(1)}%`
        : '—'
    ]
  ];

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-white/5 px-[18px] py-3.5">
        <div className="flex items-center gap-[9px]">
          <span className="h-2 w-2 rounded-full" style={{ background: containerDot(container.state) }} />
          <h2 className="font-mono text-sm font-semibold">{container.name}</h2>
          <span className="ml-auto font-mono text-[11px]" style={{ color: healthColor(container) }}>
            {container.health ?? 'no healthcheck'}
          </span>
        </div>
        <span className="font-mono text-[11.5px] break-all text-muted">{container.image}</span>
        <span className="text-xs text-fg-3">{containerStatus(container, now)}</span>
        <div className="mt-1 flex flex-wrap gap-1.5">{actions}</div>
      </div>
      <dl className="flex flex-col px-[18px] py-1">
        {meta.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-line-soft py-2 text-xs">
            <dt className="shrink-0 text-subtle">{label}</dt>
            <dd className="truncate text-right font-mono text-fg-2" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <ChipList
        title="Ports"
        items={container.ports}
        empty="no published ports"
        className="bg-track text-fg-2"
      />
      <ChipList title="Networks" items={container.networks} className="bg-accent/12 text-info-fg" />
      <div className="flex flex-col gap-1.5 px-[18px] pt-3 pb-4">
        <span className="text-[11px] text-faint">Mounts</span>
        {container.mounts.length === 0 ? (
          <span className="font-mono text-[11.5px] text-subtle">none</span>
        ) : (
          container.mounts.map(mount => (
            <span key={mount} className="font-mono text-[11.5px] break-all text-fg-3">
              {mount}
            </span>
          ))
        )}
      </div>
    </>
  );
}

function ChipList({
  title,
  items,
  className,
  empty = 'none'
}: {
  title: string;
  items: string[];
  className: string;
  empty?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-[18px] pt-3">
      <span className="text-[11px] text-faint">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="font-mono text-[11.5px] text-subtle">{empty}</span>
        ) : (
          items.map(item => (
            <span key={item} className={`rounded px-[7px] py-0.5 font-mono text-[11.5px] ${className}`}>
              {item}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
