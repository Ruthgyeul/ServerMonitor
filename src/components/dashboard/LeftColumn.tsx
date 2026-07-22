import React from 'react';
import { Activity, Clock, Cpu, Fan, HardDriveDownload, MemoryStick, Thermometer } from 'lucide-react';

import { Bar, EmptyRow, Panel, PanelTitle, Sparkline } from '@/components/dashboard/primitives';
import { DiskIoPoint } from '@/hooks/useSystemData';
import { DashboardData } from '@/utils/dashboardData';
import { formatShortDateTime } from '@/utils/format';
import { loadCellColor, loadColor, statusColor, tempColor } from '@/utils/statusColors';

// 온도 막대는 0~90°C 를 눈금 삼는다. 경고선(65°C)과 위험선(74°C)을 같은 척도로 찍는다.
const TEMP_SCALE_MAX = 90;
const TEMP_WARN = 65;
const TEMP_CRITICAL = 74;

// 코어가 많으면 막대가 238px 안에 들어가지 않는다. 표시 개수를 자르고 나머지는 숫자로 알린다.
const MAX_CORE_BARS = 16;

interface LeftColumnProps {
  data: DashboardData;
  diskIoHistory: DiskIoPoint[];
}

export const LeftColumn: React.FC<LeftColumnProps> = ({ data, diskIoHistory }) => (
  <div className="flex min-h-0 shrink-0 basis-[238px] flex-col gap-1.5">
    <UptimeCard data={data} />
    <LoadAverageCard data={data} />
    <CpuCoresCard data={data} />
    <SwapCard data={data} />
    <DiskIoCard data={data} history={diskIoHistory} />

    <div className="grid w-full grid-cols-2 gap-1.5">
      <FanCard data={data} />
      <TemperatureCard data={data} />
    </div>
  </div>
);

const UptimeCard: React.FC<{ data: DashboardData }> = ({ data }) => (
  <Panel className="flex w-full flex-col justify-center p-[9px]">
    <PanelTitle icon={Clock} color="#4ade80" label="UPTIME" className="mb-[3px]" />
    <div className="text-[15px] font-bold text-white">
      {data.uptime.days}d {data.uptime.hours}h
    </div>
    <div className="text-[9px] text-gray-400">{data.uptime.minutes}m</div>
    <div className="mt-[3px] border-t border-gray-700 pt-[3px] text-[8px] leading-[1.3] text-gray-500">
      Last reboot: {formatShortDateTime(data.host.bootTime)}
      <br />
      reason: {data.host.rebootReason ?? 'unknown'}
    </div>
  </Panel>
);

const LoadAverageCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { load, cpu, history } = data;

  // 히스토리가 아직 48칸을 못 채웠으면 앞쪽을 빈 칸으로 메워 격자 모양을 유지한다.
  const cells = [...Array(Math.max(0, 48 - history.load.length)).fill(null), ...history.load.slice(-48)];

  return (
    <Panel className="flex w-full flex-col p-[9px]">
      <PanelTitle
        icon={Activity}
        color="#f472b6"
        label="LOAD AVG"
        className="mb-[2px]"
        right={
          <span className="text-[8px]" style={{ color: loadColor(load.avg1, cpu.cores) }}>
            1m {load.avg1.toFixed(2)}
          </span>
        }
      />
      <div className="mb-[2px] flex items-center justify-between text-[8px] text-gray-500">
        <span>Last 12h</span>
        <span>
          5m {load.avg5.toFixed(2)} · 15m {load.avg15.toFixed(2)}
        </span>
      </div>
      <div className="grid grid-cols-12 grid-rows-4 gap-[3px]">
        {cells.map((cell, index) => (
          <div
            key={cell ? cell.at : `empty-${index}`}
            className="aspect-square rounded-[2px]"
            style={{ background: loadCellColor(cell?.avg1 ?? null, cpu.cores) }}
            title={cell?.avg1 != null ? `${formatShortDateTime(cell.at)} · load ${cell.avg1.toFixed(2)}` : 'no data'}
          />
        ))}
      </div>
    </Panel>
  );
};

const CpuCoresCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const all = data.cpu.perCore;
  const cores = all.slice(0, MAX_CORE_BARS);
  const hidden = all.length - cores.length;

  // 코어 수에 따라 막대 폭과 간격을 줄여 한 줄에 담는다.
  const compact = cores.length > 8;
  const barWidth = cores.length <= 4 ? 28 : cores.length <= 8 ? 18 : 9;
  const gap = cores.length <= 4 ? 10 : cores.length <= 8 ? 6 : 3;

  return (
    <Panel className="flex w-full flex-col gap-[5px] p-[7px]">
      <PanelTitle
        icon={Cpu}
        color="#60a5fa"
        label="CPU CORES"
        right={hidden > 0 ? <span className="text-[8px] text-gray-500">+{hidden}</span> : undefined}
      />
      {cores.length === 0 ? (
        <EmptyRow>per-core data unavailable</EmptyRow>
      ) : (
        <div className="flex h-10 items-end justify-center" style={{ gap }}>
          {cores.map((usage, index) => (
            <div key={index} className="flex h-full flex-col items-center justify-end gap-[2px]">
              {!compact && <span className="text-[8px] text-gray-400">{usage.toFixed(0)}</span>}
              <div
                className="flex flex-1 items-end overflow-hidden rounded-[2px] bg-gray-900"
                style={{ width: barWidth }}
                title={`C${index} · ${usage.toFixed(1)}%`}
              >
                <div className="w-full" style={{ height: `${usage}%`, background: statusColor(usage) }} />
              </div>
              {!compact && <span className="text-[8px] text-gray-500">C{index}</span>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

const SwapCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const { swap } = data;
  const color = statusColor(swap.percentage);

  return (
    <Panel className="flex w-full flex-col justify-center gap-1 p-[9px]">
      <PanelTitle
        icon={MemoryStick}
        color="#38bdf8"
        label="SWAP"
        right={
          <span className="text-[9px]" style={{ color }}>
            {swap.total > 0 ? `${swap.percentage.toFixed(0)}%` : 'off'}
          </span>
        }
      />
      <Bar percentage={swap.percentage} color={color} />
      <div className="text-[8.5px] text-gray-400">
        {swap.total > 0 ? `${swap.used.toFixed(2)}/${swap.total.toFixed(1)}GB` : 'no swap configured'}
      </div>
    </Panel>
  );
};

const DiskIoCard: React.FC<{ data: DashboardData; history: DiskIoPoint[] }> = ({ data, history }) => (
  <Panel className="flex w-full flex-col p-[9px]">
    <PanelTitle
      icon={HardDriveDownload}
      color="#38bdf8"
      label="DISK I/O"
      className="mb-[2px]"
      right={
        <span className="whitespace-nowrap text-[8px]">
          <span className="text-blue-400">R {data.diskIO.read.toFixed(1)}</span>{' '}
          <span className="text-pink-400">W {data.diskIO.write.toFixed(1)}</span>{' '}
          <span className="text-gray-500">MB/s</span>
        </span>
      }
    />
    <div className="h-[30px]">
      <Sparkline
        series={[
          { key: 'read', values: history.map(point => point.read), color: '#60a5fa' },
          { key: 'write', values: history.map(point => point.write), color: '#f472b6' }
        ]}
      />
    </div>
  </Panel>
);

const FanCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  // 메인보드마다 어느 커넥터에 팬이 꽂혀 있는지 달라서, 값이 잡히는 첫 번째를 쓴다.
  const rpm = [data.fan.cpu, data.fan.case1, data.fan.case2].find(value => value > 0) ?? 0;

  return (
    <Panel className="flex flex-col justify-center p-[9px]">
      <PanelTitle icon={Fan} color="#c084fc" label="FAN" className="mb-[3px]" />
      <div className="text-[15px] font-bold text-white">{rpm > 0 ? rpm.toLocaleString() : 'N/A'}</div>
      <div className="text-[9px] text-gray-400">RPM</div>
    </Panel>
  );
};

const TemperatureCard: React.FC<{ data: DashboardData }> = ({ data }) => {
  const temperature = data.cpu.temperature;
  const color = tempColor(temperature);
  const percentage = temperature === 'N/A' ? 0 : Math.min(100, (temperature / TEMP_SCALE_MAX) * 100);

  const headroom =
    temperature === 'N/A'
      ? 'no sensor'
      : temperature >= TEMP_CRITICAL
        ? `${(temperature - TEMP_CRITICAL).toFixed(1)}° over alert threshold`
        : `${(TEMP_CRITICAL - temperature).toFixed(1)}° to alert threshold`;

  return (
    <Panel className="flex flex-col gap-1 p-[7px]">
      <PanelTitle icon={Thermometer} color="#fb923c" label="TEMP CPU" />
      <span className="text-[13px] font-bold" style={{ color }}>
        {temperature === 'N/A' ? 'N/A' : `${temperature.toFixed(1)}°C`}
      </span>
      <Bar percentage={percentage} color={color} className="overflow-visible">
        <div
          className="absolute top-[-1px] h-[7px] w-px bg-yellow-400"
          style={{ left: `${(TEMP_WARN / TEMP_SCALE_MAX) * 100}%` }}
        />
        <div
          className="absolute top-[-1px] h-[7px] w-px bg-red-400"
          style={{ left: `${(TEMP_CRITICAL / TEMP_SCALE_MAX) * 100}%` }}
        />
      </Bar>
      <div className="text-[8px] text-gray-500">{headroom}</div>
    </Panel>
  );
};
