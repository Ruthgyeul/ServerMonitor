'use client';

import React, { useState } from 'react';
import { Flag } from 'lucide-react';

import { ThroughputChart } from '@/components/charts/ThroughputChart';
import {
  EVENT_STYLE,
  RANGES,
  X_LABELS,
  eventCounts,
  eventMarks,
  pointLabel,
  withLive
} from '@/components/overview/chartData';
import { useMetricSeries } from '@/components/overview/KpiCards';
import { Panel, StatCells } from '@/components/ui/Panel';
import { Segmented, optionsOf } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';
import type { HistoryRange, HostEvent, HostEventKind } from '@/types/system';
import type { DashboardData } from '@/utils/dashboardData';
import { formatBytes } from '@/utils/format';

// Network throughput over the chosen range, with reboot/deploy/restart markers.

const rate = (value: number) => value.toFixed(value >= 100 ? 0 : 1);

export function NetworkPanel({
  data,
  events,
  now,
  showEvents,
  onToggleEvents
}: {
  data: DashboardData;
  events: HostEvent[];
  now: number;
  // Shared with the KPI cards and remembered per browser (see the overview page).
  showEvents: boolean;
  onToggleEvents: () => void;
}) {
  const [range, setRange] = useState<HistoryRange>('1h');
  const series = useMetricSeries(range);
  const points = series?.points ?? [];
  const { network } = data;

  const marks = showEvents ? eventMarks(events, range, now) : [];
  const counts = eventCounts(events, range, now);

  return (
    <Panel
      className="flex-[2_1_560px]"
      title="Network throughput"
      headerClassName="gap-x-[18px]"
      actions={
        <>
          <span className="flex items-center gap-[7px] text-xs text-muted">
            <span className="h-0.5 w-2.5 bg-accent" />
            Download <span className="font-mono text-fg">{rate(network.download)} KB/s</span>
          </span>
          <span className="flex items-center gap-[7px] text-xs text-muted">
            <span className="h-0.5 w-2.5 bg-upload" />
            Upload <span className="font-mono text-fg">{rate(network.upload)} KB/s</span>
          </span>
          <button
            onClick={onToggleEvents}
            title="Show reboots, deploys and restarts on the charts"
            aria-pressed={showEvents}
            className={cn(
              'flex items-center gap-1.5 rounded-md border border-line-strong px-[9px] py-[3px] text-[11.5px]',
              showEvents ? 'bg-active text-fg' : 'text-subtle'
            )}
          >
            <Flag size={12} className="shrink-0" />
            Events
          </button>
          <Segmented options={optionsOf(RANGES)} value={range} onChange={setRange} label="Throughput range" />
        </>
      }
    >
      <div className="px-[18px] pt-3.5 pb-2">
        <ThroughputChart
          down={withLive(
            points.map(point => point.down),
            network.download,
            range
          )}
          up={withLive(
            points.map(point => point.up),
            network.upload,
            range
          )}
          labels={points.map(point => pointLabel(point.at, range))}
          xLabels={X_LABELS[range]}
          marks={marks}
          unit="KB/s"
        />
        {showEvents && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-2.5 pl-11 text-[11.5px] text-dim">
            {(Object.keys(EVENT_STYLE) as HostEventKind[]).map(kind => (
              <span key={kind} className="flex items-center gap-1.5">
                <span
                  className="h-[7px] w-[7px] rotate-45 rounded-[2px]"
                  style={{ background: EVENT_STYLE[kind].color }}
                />
                {EVENT_STYLE[kind].label} <span className="font-mono text-fg-3">{counts[kind]}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <StatCells
        stats={[
          { label: 'Ping', value: network.ping > 0 ? `${network.ping.toFixed(1)} ms` : '—' },
          {
            label: 'Errors rx/tx',
            value: `${network.errorRates.rx} / ${network.errorRates.tx}%`
          },
          { label: 'Connections', value: String(network.connections) },
          { label: 'Listening ports', value: String(network.listeningPorts) },
          {
            label: 'Since boot',
            value: `↓${formatBytes(network.totalRxBytes)} ↑${formatBytes(network.totalTxBytes)}`
          }
        ]}
      />
    </Panel>
  );
}
