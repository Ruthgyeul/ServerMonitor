import React from 'react';

import { Panel } from '@/components/ui/Panel';
import { Tag } from '@/components/ui/Tag';
import { rampColor, usageColor } from '@/lib/statusColors';
import type { DashboardData } from '@/utils/dashboardData';
import { formatHourMinute } from '@/utils/timeFormat';

// Per-core bars beside the 24h CPU and 48h load heatmaps.

const LEGEND = [0, 0.25, 0.5, 0.75, 1];

export function CpuLoadPanel({ data }: { data: DashboardData }) {
  const { cpu, load, history, thresholds } = data;
  const cores = Math.max(1, cpu.cores);
  const perCore = load.avg1 / cores;
  const loadClear = thresholds.ALERT_LOAD_CLEAR ?? 1.5;
  const temp = cpu.temperature === 'N/A' ? 'no sensor' : `${cpu.temperature.toFixed(1)}°C`;

  return (
    <Panel
      className="flex-[2_1_560px]"
      title="CPU & load"
      actions={
        <>
          <span className="font-mono text-xs text-muted">
            1m <span className="text-fg">{load.avg1.toFixed(2)}</span> · 5m{' '}
            <span className="text-fg">{load.avg5.toFixed(2)}</span> · 15m{' '}
            <span className="text-fg">{load.avg15.toFixed(2)}</span>
          </span>
          <Tag tone={perCore > loadClear ? 'warn' : 'ok'}>{perCore.toFixed(2)} / core</Tag>
        </>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        <div className="flex flex-col gap-3 border-r border-white/5 px-[18px] py-4">
          <span className="text-[11.5px] text-subtle">Per core</span>
          {cpu.perCore.length === 0 ? (
            <span className="text-xs text-subtle">Per-core usage isn&apos;t available on this host.</span>
          ) : (
            cpu.perCore.map((usage, index) => (
              <div key={index} className="grid grid-cols-[28px_1fr_40px] items-center gap-2.5">
                <span className="font-mono text-[11.5px] text-subtle">C{index}</span>
                <div className="h-1.5 overflow-hidden rounded-[3px] bg-track">
                  <div
                    className="h-full transition-[width] duration-400"
                    style={{ width: `${Math.min(100, usage)}%`, background: usageColor(usage) }}
                  />
                </div>
                <span className="text-right font-mono text-[11.5px]">{usage.toFixed(0)}%</span>
              </div>
            ))
          )}
          <div className="mt-1 flex gap-4 text-[11.5px] text-subtle">
            <span>
              iowait <span className="font-mono text-fg-2">{cpu.iowait.toFixed(1)}%</span>
            </span>
            <span>
              steal <span className="font-mono text-fg-2">{cpu.steal.toFixed(1)}%</span>
            </span>
            <span>
              temp <span className="font-mono text-fg-2">{temp}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3.5 px-[18px] py-4">
          <div className="flex flex-col gap-[7px]">
            <div className="flex justify-between text-[11.5px] text-subtle">
              <span>CPU usage · last 24h</span>
              <span className="font-mono">hourly avg</span>
            </div>
            <div className="grid grid-cols-[repeat(24,1fr)] gap-0.5">
              {history.cpuHourly.map(sample => (
                <div
                  key={sample.at}
                  title={`${formatHourMinute(new Date(sample.at).getTime())} · ${sample.usage === null ? 'no data' : `${sample.usage.toFixed(0)}%`}`}
                  className="h-[26px] rounded-[2px]"
                  style={{ background: rampColor(sample.usage === null ? null : sample.usage / 100) }}
                />
              ))}
            </div>
            <div className="flex justify-between font-mono text-[10.5px] text-faint">
              <span>-24h</span>
              <span>-12h</span>
              <span>now</span>
            </div>
          </div>
          <div className="flex flex-col gap-[7px]">
            <div className="flex justify-between text-[11.5px] text-subtle">
              <span>Load average · last 48h</span>
              <span className="font-mono">1 cell = 1h</span>
            </div>
            <div className="grid grid-cols-[repeat(24,1fr)] gap-0.5">
              {history.load.map(sample => (
                <div
                  key={sample.at}
                  title={`${formatHourMinute(new Date(sample.at).getTime())} · ${sample.avg1 === null ? 'no data' : `${sample.avg1.toFixed(2)} load`}`}
                  className="h-3 rounded-[2px]"
                  style={{ background: rampColor(sample.avg1 === null ? null : sample.avg1 / cores) }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[10.5px] text-faint">
              <span>idle</span>
              {LEGEND.map(level => (
                <span
                  key={level}
                  className="h-1.5 w-3.5 rounded-[1px]"
                  style={{ background: rampColor(level) }}
                />
              ))}
              <span>saturated</span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
