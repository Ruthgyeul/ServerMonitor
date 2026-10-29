'use client';

import React from 'react';

import { areaPath, indexAt, linePath } from '@/components/charts/paths';
import { useHoverFraction } from '@/components/charts/useHoverFraction';

// KPI-card sparkline (200×40 viewBox stretched to the card width) with a
// crosshair tooltip and optional event markers.

export interface ChartMark {
  fraction: number; // 0–1 across the x axis
  color: string;
  tip: string;
}

interface HoverSparklineProps {
  values: (number | null)[];
  labels: string[]; // tooltip time for each value
  max: number;
  stroke: string;
  fill: string;
  format: (value: number) => string;
  marks?: ChartMark[];
}

const BOX = { x: 0, y: 1, width: 200, height: 38 };

export function HoverSparkline({
  values,
  labels,
  max,
  stroke,
  fill,
  format,
  marks = []
}: HoverSparklineProps) {
  const { fraction, handlers } = useHoverFraction();
  const index = fraction === null ? null : indexAt(fraction, values.length);
  const hovered = index === null ? null : values[index];
  const left = index === null || values.length < 2 ? 0 : (index / (values.length - 1)) * 100;
  const top =
    hovered === null || hovered === undefined
      ? null
      : ((BOX.y + BOX.height - (Math.min(max, hovered) / max) * BOX.height) / 40) * 100;

  return (
    <div {...handlers} className="relative h-10 cursor-crosshair touch-pan-y">
      <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="block h-10 w-full">
        <path d={areaPath(values, BOX, max)} fill={fill} />
        <path
          d={linePath(values, BOX, max)}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {marks.map(mark => (
        <span
          key={`${mark.fraction}-${mark.tip}`}
          title={mark.tip}
          className="pointer-events-none absolute inset-y-0 border-l border-dashed opacity-60"
          style={{ left: `${mark.fraction * 100}%`, borderColor: mark.color }}
        />
      ))}
      {index !== null && (
        <>
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-fg/40"
            style={{ left: `${left}%` }}
          />
          {top !== null && (
            <span
              className="pointer-events-none absolute -mt-[5px] -ml-[5px] h-[7px] w-[7px] rounded-full border-2 border-card"
              style={{ top: `${top}%`, left: `${left}%`, background: stroke }}
            />
          )}
          <div
            className="pointer-events-none absolute bottom-[calc(100%+6px)] z-[3] flex gap-2 rounded-md border border-white/10 bg-[#1f2430] px-2 py-[5px] font-mono text-[11px] whitespace-nowrap"
            style={{
              left: `${left}%`,
              transform: left > 60 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)'
            }}
          >
            <span className="text-fg">
              {hovered === null || hovered === undefined ? '—' : format(hovered)}
            </span>
            <span className="text-dim">{labels[index] ?? ''}</span>
          </div>
        </>
      )}
    </div>
  );
}
