'use client';

import React from 'react';

import type { ChartMark } from '@/components/charts/HoverSparkline';
import { areaPath, indexAt, linePath, niceMax } from '@/components/charts/paths';
import { useHoverFraction } from '@/components/charts/useHoverFraction';
import { PALETTE } from '@/lib/theme';

// Download/upload throughput over time (760×220 viewBox, left gutter for the
// axis labels) with a crosshair tooltip and dashed event markers.

const VIEW_W = 760;
const VIEW_H = 220;
const GUTTER = 44;
const BOX = { x: GUTTER, y: 5, width: VIEW_W - GUTTER, height: 210 };
const GRID = [1, 0.75, 0.5, 0.25, 0];

interface ThroughputChartProps {
  down: (number | null)[];
  up: (number | null)[];
  labels: string[]; // tooltip time per point
  xLabels: string[];
  marks: ChartMark[];
  unit: string;
}

const fmt = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(value < 1 ? 2 : 1);
};

export function ThroughputChart({ down, up, labels, xLabels, marks, unit }: ThroughputChartProps) {
  const peak = Math.max(
    0,
    ...down.filter((v): v is number => v !== null),
    ...up.filter((v): v is number => v !== null)
  );
  const max = niceMax(peak);
  const { fraction, handlers } = useHoverFraction(GUTTER / VIEW_W, 1);
  const index = fraction === null ? null : indexAt(fraction, down.length);
  const plotLeft = (fraction: number) => ((GUTTER + fraction * BOX.width) / VIEW_W) * 100;
  const yPercent = (value: number | null | undefined) =>
    value === null || value === undefined
      ? null
      : ((BOX.y + BOX.height - (Math.min(max, value) / max) * BOX.height) / VIEW_H) * 100;

  const hoverLeft = index === null || down.length < 2 ? 0 : plotLeft(index / (down.length - 1));
  const near =
    index === null || down.length < 2
      ? null
      : (marks.find(mark => Math.abs(mark.fraction - index / (down.length - 1)) <= 2 / down.length) ?? null);

  return (
    <div>
      <div {...handlers} className="relative cursor-crosshair touch-pan-y">
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="block h-60 w-full">
          <defs>
            <linearGradient id="throughput-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={PALETTE.upload} stopOpacity="0.22" />
              <stop offset="1" stopColor={PALETTE.upload} stopOpacity="0" />
            </linearGradient>
          </defs>
          {GRID.map(level => {
            const y = BOX.y + BOX.height - level * BOX.height;
            return (
              <g key={level}>
                <line x1={GUTTER} x2={VIEW_W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" />
                <text
                  x={36}
                  y={y + 3}
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                  fill={PALETTE.faint}
                  textAnchor="end"
                >
                  {fmt(max * level)}
                </text>
              </g>
            );
          })}
          <path d={areaPath(up, BOX, max)} fill="url(#throughput-up)" />
          <path
            d={linePath(up, BOX, max)}
            fill="none"
            stroke={PALETTE.upload}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={linePath(down, BOX, max)}
            fill="none"
            stroke={PALETTE.accent}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {marks.map(mark => (
          <div
            key={`${mark.fraction}-${mark.tip}`}
            title={mark.tip}
            className="absolute inset-y-0 z-[2] -ml-1.5 flex w-3 cursor-help justify-center"
            style={{ left: `${plotLeft(mark.fraction)}%` }}
          >
            <span className="h-full border-l border-dashed opacity-85" style={{ borderColor: mark.color }} />
            <span
              className="absolute -top-1 h-2 w-2 rotate-45 rounded-[2px] shadow-[0_0_0_2px_var(--color-card)]"
              style={{ background: mark.color }}
            />
          </div>
        ))}

        {index !== null && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-fg/35"
              style={{ left: `${hoverLeft}%` }}
            />
            {[
              [up[index], PALETTE.upload],
              [down[index], PALETTE.accent]
            ].map(([value, color]) => {
              const top = yPercent(value as number | null);
              return top === null ? null : (
                <span
                  key={color as string}
                  className="pointer-events-none absolute -mt-1.5 -ml-1.5 h-2 w-2 rounded-full border-2 border-card"
                  style={{ top: `${top}%`, left: `${hoverLeft}%`, background: color as string }}
                />
              );
            })}
            <div
              className="pointer-events-none absolute top-1.5 z-[3] flex min-w-40 flex-col gap-1.5 rounded-lg border border-white/10 bg-[#1f2430] px-[11px] py-[9px] shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
              style={{
                left: `${hoverLeft}%`,
                transform: hoverLeft > 60 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)'
              }}
            >
              <span className="font-mono text-[11px] text-muted">{labels[index] ?? ''}</span>
              {(
                [
                  ['Download', down[index], PALETTE.accent],
                  ['Upload', up[index], PALETTE.upload]
                ] as const
              ).map(([name, value, color]) => (
                <span key={name} className="flex items-center gap-[7px] text-xs text-fg-3">
                  <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} />
                  <span className="flex-1">{name}</span>
                  <span className="font-mono text-fg">
                    {fmt(value)} {unit}
                  </span>
                </span>
              ))}
              {near && (
                <span className="border-t border-white/8 pt-1.5 text-[11.5px]" style={{ color: near.color }}>
                  {near.tip}
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between pt-1.5 pl-11 font-mono text-[10.5px] text-faint">
        {xLabels.map(label => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
