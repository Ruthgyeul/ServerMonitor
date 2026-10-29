'use client';

import React, { useState } from 'react';

import { formatSize } from '@/components/docker/format';
import { Segmented } from '@/components/ui/Segmented';
import type { DockerDetails } from '@/types/system';
import { formatAge } from '@/utils/timeFormat';

// Images / Volumes / Networks tables. `imageActions` renders per-image buttons
// (e.g. remove) when the caller allows them.

type Tab = 'images' | 'volumes' | 'networks';

const TABS = [
  { value: 'images', label: 'Images' },
  { value: 'volumes', label: 'Volumes' },
  { value: 'networks', label: 'Networks' }
] as const;

const headCell = 'px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint';
const row = 'items-center border-t border-line-soft px-[18px] py-2 font-mono text-xs';

interface ResourceTabsProps {
  details: DockerDetails;
  now: number;
  imageActions?: (imageId: string, inUse: boolean) => React.ReactNode;
}

export function ResourceTabs({ details, now, imageActions }: ResourceTabsProps) {
  const [tab, setTab] = useState<Tab>('images');
  const usedColor = (inUse: boolean) => (inUse ? 'text-fg-3' : 'text-warn-fg');

  return (
    <section className="min-w-0 flex-[3_1_620px] overflow-hidden rounded-[10px] border border-line bg-card">
      <div className="flex items-center gap-2.5 border-b border-white/5 px-[18px] py-3">
        <Segmented options={TABS} value={tab} onChange={setTab} label="Docker resources" />
      </div>
      <div className="overflow-x-auto">
        {tab === 'images' && (
          <div className="min-w-[640px]">
            <div
              className={`grid grid-cols-[minmax(0,1.6fr)_100px_110px_80px_80px_minmax(0,1fr)_70px] gap-3 ${headCell}`}
            >
              <span>Repository</span>
              <span>Tag</span>
              <span>Image ID</span>
              <span className="text-right">Size</span>
              <span>Created</span>
              <span>Used by</span>
              <span />
            </div>
            {details.images.map(image => (
              <div
                key={`${image.id}-${image.repository}-${image.tag}`}
                className={`grid grid-cols-[minmax(0,1.6fr)_100px_110px_80px_80px_minmax(0,1fr)_70px] gap-3 ${row}`}
              >
                <span className="truncate">{image.repository}</span>
                <span className="truncate text-fg-3">{image.tag}</span>
                <span className="text-subtle">{image.id}</span>
                <span className="text-right">{formatSize(image.sizeBytes)}</span>
                <span className="text-subtle">
                  {image.createdAt ? `${formatAge(now - new Date(image.createdAt).getTime())} ago` : '—'}
                </span>
                <span className={`truncate ${usedColor(image.usedBy.length > 0)}`}>
                  {image.usedBy.length ? image.usedBy.join(', ') : 'unused'}
                </span>
                <span className="flex justify-end">{imageActions?.(image.id, image.usedBy.length > 0)}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'volumes' && (
          <div className="min-w-[520px]">
            <div className={`grid grid-cols-[minmax(0,1.4fr)_80px_90px_minmax(0,1fr)] gap-3 ${headCell}`}>
              <span>Volume</span>
              <span>Driver</span>
              <span className="text-right">Size</span>
              <span>Mounted by</span>
            </div>
            {details.volumes.map(volume => (
              <div
                key={volume.name}
                className={`grid grid-cols-[minmax(0,1.4fr)_80px_90px_minmax(0,1fr)] gap-3 ${row}`}
              >
                <span className="truncate">{volume.name}</span>
                <span className="text-subtle">{volume.driver}</span>
                <span className="text-right">{formatSize(volume.sizeBytes)}</span>
                <span className={`truncate ${usedColor(volume.usedBy.length > 0)}`}>
                  {volume.usedBy.length ? volume.usedBy.join(', ') : 'unused'}
                </span>
              </div>
            ))}
          </div>
        )}
        {tab === 'networks' && (
          <div className="min-w-[560px]">
            <div className={`grid grid-cols-[130px_70px_130px_40px_minmax(0,1fr)] gap-3 ${headCell}`}>
              <span>Network</span>
              <span>Driver</span>
              <span>Subnet</span>
              <span className="text-right">#</span>
              <span>Containers</span>
            </div>
            {details.networks.map(network => (
              <div
                key={network.name}
                className={`grid grid-cols-[130px_70px_130px_40px_minmax(0,1fr)] gap-3 ${row}`}
              >
                <span className="truncate">{network.name}</span>
                <span className="text-subtle">{network.driver}</span>
                <span className="text-muted">{network.subnet ?? '—'}</span>
                <span className="text-right">{network.containers.length}</span>
                <span className="truncate text-fg-3">{network.containers.join(', ') || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
