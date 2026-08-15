'use client';

import React, { useRef, useState } from 'react';

import { NetworkHistoryEntry } from '@/types/system';
import { rateUnit } from '@/utils/format';

// An SVG that reproduces the design's chart. Inside a fixed canvas (1024x600)
// recharts' responsive measurement isn't needed, and a viewBox alone gives exactly the same proportions.
const WIDTH = 700;
const HEIGHT = 260;
const PAD_LEFT = 50;
const PAD_RIGHT = 10;
const PAD_TOP = 8;
const PAD_BOTTOM = 16;
const TICK_COUNT = 4;

// The crosshair tooltip. Monospace has a constant glyph width, so the width can be computed from the character count.
const READOUT_FONT = 9;
const READOUT_CHAR_W = READOUT_FONT * 0.62;
const READOUT_PAD = 6;
const READOUT_LINE = 11;

// Round the axis max up to a 1/2/5 multiple so the tick numbers don't get messy.
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  // Screen coords -> viewBox coords. preserveAspectRatio can produce letterboxing,
  // so use the inverse CTM rather than estimating from the width ratio.
  const indexAt = (clientX: number, clientY: number, count: number): number | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;

    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const span = WIDTH - PAD_LEFT - PAD_RIGHT;
    const ratio = (point.x - PAD_LEFT) / span;
    return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
  };

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
    data
      .map((entry, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(entry[key]).toFixed(1)}`)
      .join(' ');

  const area = (key: 'download' | 'upload') =>
    `${line(key)} L${x(data.length - 1).toFixed(1)},${PAD_TOP + innerHeight} L${x(0).toFixed(1)},${PAD_TOP + innerHeight} Z`;

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, index) => (max / TICK_COUNT) * index);

  const activeEntry = active === null ? null : data[active];

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      // Mouse picks a point via hover, touch via tap/drag. Don't touch
      // touch-action — blocking vertical page scroll over the chart would cost more.
      onPointerMove={event => setActive(indexAt(event.clientX, event.clientY, data.length))}
      onPointerDown={event => setActive(indexAt(event.clientX, event.clientY, data.length))}
      onPointerLeave={() => setActive(null)}
    >
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

      <line
        x1={PAD_LEFT}
        y1={PAD_TOP}
        x2={PAD_LEFT}
        y2={PAD_TOP + innerHeight}
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={1}
      />
      <line
        x1={PAD_LEFT}
        y1={PAD_TOP + innerHeight}
        x2={PAD_LEFT + innerWidth}
        y2={PAD_TOP + innerHeight}
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={1}
      />

      {ticks.map(tick => (
        <g key={tick}>
          <line
            x1={PAD_LEFT - 4}
            y1={y(tick * divisor)}
            x2={PAD_LEFT}
            y2={y(tick * divisor)}
            stroke="rgba(255,255,255,0.14)"
            strokeWidth={1}
          />
          <text x={PAD_LEFT - 8} y={y(tick * divisor) + 3} fontSize={9} fill="#9ca3af" textAnchor="end">
            {`${tick.toFixed(tick < 2 ? 1 : 0)} ${unit}`}
          </text>
        </g>
      ))}

      <path d={area('download')} fill="url(#downloadArea)" stroke="none" />
      <path d={area('upload')} fill="url(#uploadArea)" stroke="none" />
      <path d={line('download')} fill="none" stroke="#3b82f6" strokeWidth={2} />
      <path d={line('upload')} fill="none" stroke="#10b981" strokeWidth={2} />

      <text
        x={PAD_LEFT + innerWidth}
        y={PAD_TOP + innerHeight + 14}
        fontSize={9}
        fill="#6b7280"
        textAnchor="end"
      >
        now
      </text>

      {activeEntry &&
        active !== null &&
        (() => {
          const cx = x(active);
          const lines = [
            activeEntry.time,
            `↓ ${(activeEntry.download / divisor).toFixed(1)} ${unit}`,
            `↑ ${(activeEntry.upload / divisor).toFixed(1)} ${unit}`
          ];
          const boxWidth = Math.max(...lines.map(text => text.length)) * READOUT_CHAR_W + READOUT_PAD * 2;
          const boxHeight = lines.length * READOUT_LINE + READOUT_PAD * 2 - 3;
          // At the right edge the tooltip would run off the axis, so pin it to the left of the cursor.
          const flip = cx + 10 + boxWidth > PAD_LEFT + innerWidth;
          const boxX = flip ? cx - 10 - boxWidth : cx + 10;

          return (
            <g pointerEvents="none">
              <line
                x1={cx}
                y1={PAD_TOP}
                x2={cx}
                y2={PAD_TOP + innerHeight}
                stroke="rgba(255,255,255,0.28)"
                strokeWidth={1}
              />
              <circle
                cx={cx}
                cy={y(activeEntry.download)}
                r={3}
                fill="#3b82f6"
                stroke="#0a0d13"
                strokeWidth={1.5}
              />
              <circle
                cx={cx}
                cy={y(activeEntry.upload)}
                r={3}
                fill="#10b981"
                stroke="#0a0d13"
                strokeWidth={1.5}
              />

              <rect
                x={boxX}
                y={PAD_TOP + 4}
                width={boxWidth}
                height={boxHeight}
                rx={4}
                fill="#111621"
                stroke="rgba(255,255,255,0.14)"
                strokeWidth={1}
              />
              {lines.map((text, row) => (
                <text
                  key={text}
                  x={boxX + READOUT_PAD}
                  y={PAD_TOP + 4 + READOUT_PAD + READOUT_LINE * row + READOUT_FONT - 2}
                  fontSize={READOUT_FONT}
                  fill={row === 0 ? '#8b93a7' : row === 1 ? '#54a2ff' : '#00d294'}
                >
                  {text}
                </text>
              ))}
            </g>
          );
        })()}
    </svg>
  );
};
