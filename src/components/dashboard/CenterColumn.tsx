import React from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, Monitor, Network, TrendingUp } from 'lucide-react';

import { NetworkAreaChart } from '@/components/charts/NetworkAreaChart';
import { Bar, EmptyRow, Gauge, Panel, PanelTitle } from '@/components/dashboard/primitives';
import { NetworkHistoryEntry } from '@/types/system';
import { DashboardData } from '@/utils/dashboardData';
import { formatLinkSpeed } from '@/utils/format';
import { COLORS, statusColor } from '@/utils/statusColors';

interface CenterColumnProps {
  data: DashboardData;
  networkHistory: NetworkHistoryEntry[];
}

export const CenterColumn: React.FC<CenterColumnProps> = ({ data, networkHistory }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-2 px-1">
    <GaugeRow data={data} />
    <CpuDayHeatmap data={data} />

    <Panel className="flex shrink-0 basis-[230px] flex-col p-2">
      <PanelTitle icon={Network} color="#22d3ee" label="NETWORK ACTIVITY" className="mb-[2px] shrink-0" />
      <div className="flex shrink-0 items-center justify-center gap-3.5 text-[9px] text-gray-400">
        <div className="flex items-center gap-[3px]">
          <div className="h-[7px] w-[7px] rounded-full bg-blue-500" />
          Download
        </div>
        <div className="flex items-center gap-[3px]">
          <div className="h-[7px] w-[7px] rounded-full bg-emerald-500" />
          Upload
        </div>
      </div>
      <div className="min-h-0 flex-1 py-[2px]">
        <NetworkAreaChart data={networkHistory} />
      </div>
    </Panel>

    <div className="flex shrink-0 gap-2">
      <InterfacesCard data={data} />
      <BandwidthCard data={data} />
    </div>

    <NetworkStrip data={data} />
  </div>
);

interface GaugeCardProps {
  icon: typeof Cpu;
  iconColor: string;
  label: string;
  percentage: number | null;
  caption: string;
}

const GaugeCard: React.FC<GaugeCardProps> = ({ icon: Icon, iconColor, label, percentage, caption }) => {
  const color = percentage === null ? COLORS.muted : statusColor(percentage);

  return (
    <Panel className="flex flex-col items-center overflow-hidden p-1.5">
      <div className="mb-1 flex w-full items-center gap-1">
        <Icon size={11} color={iconColor} strokeWidth={2} />
        <span className="text-[8.5px] text-gray-300">{label}</span>
      </div>
      <Gauge percentage={percentage ?? 0} color={color} />
      <div className="mt-[3px] text-[12px] font-bold" style={{ color }}>
        {percentage === null ? 'N/A' : `${percentage.toFixed(1)}%`}
      </div>
      <div className="text-[8px] text-gray-400">{caption}</div>
    </Panel>
  );
};

const GaugeRow: React.FC<{ data: DashboardData }> = ({ data }) => {
  const toGb = (mb: number) => (mb / 1024).toFixed(2);
  const gpuTemperature = data.gpu.temperature === 'N/A' ? 'no sensor' : `${data.gpu.temperature.toFixed(1)}°C`;

  return (
    <div className="grid shrink-0 grid-cols-4 gap-2">
      <GaugeCard
        icon={Cpu}
        iconColor="#60a5fa"
        label="CPU"
        percentage={data.cpu.usage}
        caption={`${data.cpu.cores} cores`}
      />
      <GaugeCard
        icon={Monitor}
        iconColor="#c084fc"
        label="GPU"
        percentage={data.gpu.usage === 'N/A' ? null : data.gpu.usage}
        caption={gpuTemperature}
      />
      <GaugeCard
        icon={MemoryStick}
        iconColor="#4ade80"
        label="RAM"
        percentage={data.memory.percentage}
        caption={`${toGb(data.memory.used)}/${toGb(data.memory.total)}G`}
      />
      <GaugeCard
        icon={HardDrive}
        iconColor="#facc15"
        label="DISK"
        percentage={data.disk.percentage}
        caption={`${data.disk.used.toFixed(1)}/${data.disk.total.toFixed(1)}G`}
      />
    </div>
  );
};

const CpuDayHeatmap: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Panel className="flex shrink-0 flex-col gap-1 p-[7px]">
    <PanelTitle icon={Activity} color="#fb923c" label="CPU LOAD — LAST 24H" />
    <div className="flex gap-[2px]">
      {data.history.cpuHourly.map(sample => (
        <div
          key={sample.at}
          className="h-4 flex-1 rounded-[2px]"
          style={{ background: sample.usage === null ? COLORS.empty : statusColor(sample.usage) }}
          title={
            sample.usage === null
              ? `${new Date(sample.at).getHours()}:00 — no data`
              : `${new Date(sample.at).getHours()}:00 — ${sample.usage.toFixed(0)}%`
          }
        />
      ))}
      {data.history.cpuHourly.length === 0 && <EmptyRow>collecting hourly averages…</EmptyRow>}
    </div>
  </Panel>
);

const InterfacesCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  // 3개까지만 보여준다. 도커 브리지까지 다 그리면 카드가 넘친다.
  const interfaces = data.network.interfaces.slice(0, 3);

  return (
    <Panel className="flex min-w-0 flex-1 flex-col gap-1 p-[7px]">
      <PanelTitle icon={Network} color="#22d3ee" label="INTERFACES" />
      {interfaces.length === 0 && <EmptyRow>no interfaces detected</EmptyRow>}
      {interfaces.map(entry => (
        <div key={entry.name} className="flex justify-between gap-2 text-[9.5px]">
          <span className="truncate text-gray-400">
            {entry.name} <span className="text-gray-500">{entry.ip ?? '—'}</span>
          </span>
          <span
            className={`shrink-0 font-mono ${entry.state === 'up' ? 'text-green-400' : 'text-gray-500'}`}
          >
            {entry.state !== 'up'
              ? entry.state
              : entry.speedMbps === null
                ? 'up'
                : entry.speedMbps >= 1000
                  ? `${entry.speedMbps / 1000}Gbps`
                  : `${entry.speedMbps}Mbps`}
          </span>
        </div>
      ))}
    </Panel>
  );
};

const BandwidthCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const percentage = data.network.bandwidthPercentage;
  const color = statusColor(percentage);

  return (
    <Panel className="flex min-w-0 flex-1 flex-col gap-1 p-[7px]">
      <PanelTitle
        icon={TrendingUp}
        color="#a78bfa"
        label="BANDWIDTH"
        right={
          <span className="text-[9px]" style={{ color }}>
            {data.network.linkSpeedMbps === null ? '—' : `${percentage.toFixed(1)}%`}
          </span>
        }
      />
      <Bar percentage={percentage} color={color} />
      <div className="text-[8px] text-gray-500">of {formatLinkSpeed(data.network.linkSpeedMbps)}</div>
    </Panel>
  );
};

const NetworkStrip: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Panel className="flex shrink-0 items-center justify-around px-2.5 py-1.5">
    <StripItem value={data.network.ping.toFixed(1)} unit="ms ping" color="text-yellow-400" />
    <StripItem
      value={`${data.network.errorRates.rx}/${data.network.errorRates.tx}%`}
      unit="err"
      color="text-red-400"
    />
    <StripItem value={String(data.network.connections)} unit="conns" color="text-green-400" />
    <StripItem value={String(data.network.listeningPorts)} unit="ports" color="text-sky-400" />
  </Panel>
);

const StripItem: React.FC<{ value: string; unit: string; color: string }> = ({ value, unit, color }) => (
  <div className="shrink-0 whitespace-nowrap text-[10px]">
    <span className={`font-mono ${color}`}>{value}</span>
    <span className="text-gray-500"> {unit}</span>
  </div>
);
