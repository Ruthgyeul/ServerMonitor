import React from 'react';

import { NetworkHistoryEntry } from '@/types/system';
import { rateUnit } from '@/utils/format';

// 시안의 차트를 그대로 옮긴 SVG. 고정 캔버스(1024x600) 안에서는 recharts 의
// 반응형 측정이 필요 없고, viewBox 만으로 정확히 같은 비율이 나온다.
const WIDTH = 700;
const HEIGHT = 260;
const PAD_LEFT = 50;
const PAD_RIGHT = 10;
const PAD_TOP = 8;
const PAD_BOTTOM = 16;
const TICK_COUNT = 4;

// 축 최댓값을 1/2/5 배수로 올려 눈금 숫자가 지저분해지지 않게 한다.
function niceMax(value: number): number {
  if (value <= 0) return 4;
  const raw = value / TICK_COUNT;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude * TICK_COUNT;
}

interface NetworkAreaChartProps {
  data: NetworkHistoryEntry[];
}

export const NetworkAreaChart: React.FC<NetworkAreaChartProps> = ({ data }) => {
  if (data.length < 2) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">
        Collecting network data…
      </div>
    );
  }

  const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const peak = Math.max(0.001, ...data.flatMap(entry => [entry.download, entry.upload]));
  const { unit, divisor } = rateUnit(peak);
  const max = niceMax(peak / divisor);

  const x = (index: number) => PAD_LEFT + (index / (data.length - 1)) * innerWidth;
  const y = (value: number) =>
    PAD_TOP + innerHeight - (Math.max(0, Math.min(max, value / divisor)) / max) * innerHeight;

  const line = (key: 'download' | 'upload') =>
    data.map((entry, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(entry[key]).toFixed(1)}`).join(' ');

  const area = (key: 'download' | 'upload') =>
    `${line(key)} L${x(data.length - 1).toFixed(1)},${PAD_TOP + innerHeight} L${x(0).toFixed(1)},${PAD_TOP + innerHeight} Z`;

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, index) => (max / TICK_COUNT) * index);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="downloadArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="uploadArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
        </linearGradient>
      </defs>

      <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + innerHeight} stroke="#374151" strokeWidth={1} />
      <line
        x1={PAD_LEFT}
        y1={PAD_TOP + innerHeight}
        x2={PAD_LEFT + innerWidth}
        y2={PAD_TOP + innerHeight}
        stroke="#374151"
        strokeWidth={1}
      />

      {ticks.map(tick => (
        <g key={tick}>
          <line x1={PAD_LEFT - 4} y1={y(tick * divisor)} x2={PAD_LEFT} y2={y(tick * divisor)} stroke="#4b5563" strokeWidth={1} />
          <text x={PAD_LEFT - 8} y={y(tick * divisor) + 3} fontSize={9} fill="#9ca3af" textAnchor="end">
            {`${tick.toFixed(tick < 2 ? 1 : 0)} ${unit}`}
          </text>
        </g>
      ))}

      <path d={area('download')} fill="url(#downloadArea)" stroke="none" />
      <path d={area('upload')} fill="url(#uploadArea)" stroke="none" />
      <path d={line('download')} fill="none" stroke="#3b82f6" strokeWidth={2} />
      <path d={line('upload')} fill="none" stroke="#10b981" strokeWidth={2} />

      <text x={PAD_LEFT + innerWidth} y={PAD_TOP + innerHeight + 14} fontSize={9} fill="#6b7280" textAnchor="end">
        now
      </text>
    </svg>
  );
};
