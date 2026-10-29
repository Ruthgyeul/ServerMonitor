import React from 'react';

import { formatSize } from '@/components/docker/format';
import { PALETTE } from '@/lib/theme';
import type { DockerDiskUsage } from '@/types/system';

// Docker's own disk usage by category, with what pruning would reclaim.
// `footer` holds the prune buttons when control actions are enabled.

const CATEGORIES: { type: DockerDiskUsage['type']; label: string; color: string }[] = [
  { type: 'images', label: 'Images', color: PALETTE.accent },
  { type: 'volumes', label: 'Volumes', color: PALETTE.upload },
  { type: 'containers', label: 'Containers', color: PALETTE.ok },
  { type: 'buildCache', label: 'Build cache', color: PALETTE.warn }
];

export function DiskUsagePanel({ disk, footer }: { disk: DockerDiskUsage[]; footer?: React.ReactNode }) {
  const byType = new Map(disk.map(entry => [entry.type, entry]));
  const total = disk.reduce((sum, entry) => sum + entry.sizeBytes, 0);

  return (
    <section className="min-w-0 flex-[1_1_320px] rounded-[10px] border border-line bg-card">
      <div className="flex items-center border-b border-white/5 px-[18px] py-3.5">
        <h2 className="flex-1 text-[13.5px] font-medium">Disk usage</h2>
        <span className="font-mono text-xs text-fg-2">{formatSize(total)}</span>
      </div>
      <div className="px-[18px] pt-3.5 pb-1.5">
        <div className="flex h-2 gap-0.5 overflow-hidden rounded bg-track">
          {CATEGORIES.map(category => (
            <span
              key={category.type}
              style={{
                width: `${total ? ((byType.get(category.type)?.sizeBytes ?? 0) / total) * 100 : 0}%`,
                background: category.color
              }}
            />
          ))}
        </div>
      </div>
      {CATEGORIES.map(category => {
        const entry = byType.get(category.type);
        return (
          <div
            key={category.type}
            className="grid grid-cols-[12px_1fr_auto] items-center gap-2.5 px-[18px] py-2 text-xs"
          >
            <span className="h-2 w-2 rounded-[2px]" style={{ background: category.color }} />
            <span className="text-fg-3">
              {category.label}
              <span className="ml-1.5 font-mono text-subtle">
                {entry?.reclaimableBytes ? `${formatSize(entry.reclaimableBytes)} reclaimable` : '—'}
              </span>
            </span>
            <span className="font-mono">{formatSize(entry?.sizeBytes ?? 0)}</span>
          </div>
        );
      })}
      {footer && (
        <div className="mt-1.5 flex flex-col gap-1.5 border-t border-white/5 px-[18px] pt-3 pb-4">
          {footer}
        </div>
      )}
    </section>
  );
}
