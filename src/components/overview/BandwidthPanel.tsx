'use client';

import React, { useState } from 'react';
import { ChartColumn } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { Panel, StatCells } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useBandwidthHistory } from '@/hooks/useBandwidthHistory';

// Daily download/upload totals as stacked bars, 30 or 90 days.

const SPANS = [
  { value: 30, label: '30d' },
  { value: 90, label: '90d' }
] as const;

const volume = (mb: number) => {
  if (mb >= 1_000_000) return `${(mb / 1_000_000).toFixed(2)} TB`;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};
const day = (date: string) => date.slice(5);

export function BandwidthPanel() {
  const [span, setSpan] = useState<30 | 90>(30);
  const { days } = useBandwidthHistory(span);
  const list = days ?? [];
  const totals = list.map(d => d.downloadMB + d.uploadMB);
  const peakValue = Math.max(0, ...totals);
  const peakIndex = totals.indexOf(peakValue);
  const down = list.reduce((sum, d) => sum + d.downloadMB, 0);
  const up = list.reduce((sum, d) => sum + d.uploadMB, 0);
  const empty = peakValue === 0;

  return (
    <Panel
      className="flex-[2_1_560px]"
      title="Bandwidth by day"
      actions={
        <>
          <span className="flex items-center gap-[7px] text-xs text-muted">
            <span className="h-2 w-2 rounded-[2px] bg-accent" />
            Download
          </span>
          <span className="flex items-center gap-[7px] text-xs text-muted">
            <span className="h-2 w-2 rounded-[2px] bg-upload" />
            Upload
          </span>
          <Segmented options={SPANS} value={span} onChange={setSpan} label="Bandwidth span" />
        </>
      }
    >
      {empty ? (
        <EmptyState
          icon={ChartColumn}
          title="Collecting daily totals"
          body="The first bar appears after midnight. Daily totals are kept for 90 days."
        />
      ) : (
        <div className="px-[18px] pt-4 pb-2.5">
          <div className="flex h-[150px] items-end gap-0.5">
            {list.map(d => (
              <div
                key={d.date}
                title={`${day(d.date)} · ↓ ${volume(d.downloadMB)}  ↑ ${volume(d.uploadMB)}`}
                className="flex h-full min-w-0 flex-1 flex-col justify-end gap-px hover:opacity-75"
              >
                <div
                  className="rounded-t-[2px] bg-accent"
                  style={{ height: `${(d.downloadMB / peakValue) * 100}%` }}
                />
                <div className="bg-upload" style={{ height: `${(d.uploadMB / peakValue) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-faint">
            <span>{list[0] ? day(list[0].date) : ''}</span>
            <span>
              {list[Math.floor(list.length / 2)] ? day(list[Math.floor(list.length / 2)].date) : ''}
            </span>
            <span>{list.at(-1) ? day(list.at(-1)!.date) : ''}</span>
          </div>
        </div>
      )}
      <StatCells
        min={130}
        stats={[
          { label: 'Download', value: volume(down) },
          { label: 'Upload', value: volume(up) },
          { label: 'Daily average', value: volume(list.length ? (down + up) / list.length : 0) },
          { label: 'Peak day', value: empty ? '—' : `${day(list[peakIndex].date)} · ${volume(peakValue)}` }
        ]}
      />
    </Panel>
  );
}
