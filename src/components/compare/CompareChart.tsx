'use client';

import React from 'react';

import { delta, formatValue, type CompareMetric, type Delta } from '@/components/compare/compareData';
import { areaPath, indexAt, linePath, niceMax } from '@/components/charts/paths';
import { useHoverFraction } from '@/components/charts/useHoverFraction';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';

// Current period (solid, filled) over the previous one (dashed), with a "now"
// line and a tooltip showing both values and their difference.

// Up is the warning direction for a usage metric; down is the good one.
const DELTA_TEXT: Record<Delta['tone'], string> = {
  up: 'text-warn-fg',
  down: 'text-ok-fg',
  flat: 'text-fg-3',
  none: 'text-muted'
};

const VIEW_W = 760;
const VIEW_H = 240;
const GUTTER = 44;
const BOX = { x: GUTTER, y: 8, width: VIEW_W - GUTTER, height: 220 };
const GRID = [1, 0.75, 0.5, 0.25, 0];

interface CompareChartProps {
  metric: CompareMetric;
  current: (number | null)[];
  previous: (number | null)[];
  nowIndex: number; // last index of `current` that has happened
  labels: string[];
  xLabels: string[];
  currentLabel: string;
  previousLabel: string;
  previousEmpty: boolean;
}

export function CompareChart(props: CompareChartProps) {
  const { metric, current, previous, nowIndex, labels } = props;
  const length = Math.max(current.length, previous.length, 2);
  const pad = (values: (number | null)[]) => [
    ...values,
    ...Array<null>(Math.max(0, length - values.length)).fill(null)
  ];
  const past = pad(current.map((value, index) => (index <= nowIndex ? value : null)));
  const prev = pad(previous);
  const known = [...past, ...prev].filter((value): value is number => value !== null);
  const max =
    metric === 'load' || metric === 'net'
      ? niceMax(Math.max(0, ...known))
      : Math.min(100, niceMax(Math.max(0, ...known)));

  const { fraction, handlers } = useHoverFraction(GUTTER / VIEW_W, 1);
  const index = fraction === null ? null : indexAt(fraction, length);
  const hoverDelta =
    index !== null && index <= nowIndex && !props.previousEmpty
      ? delta(past[index] ?? null, prev[index] ?? null)
      : null;
  const left = (i: number) => ((GUTTER + (i / (length - 1)) * BOX.width) / VIEW_W) * 100;
  const top = (value: number | null) =>
    value === null ? null : ((BOX.y + BOX.height - (Math.min(max, value) / max) * BOX.height) / VIEW_H) * 100;
  const axis = (value: number) =>
    metric === 'load'
      ? value.toFixed(2)
      : `${value % 1 ? value.toFixed(1) : value}${metric === 'net' ? 'K' : '%'}`;

  return (
    <div>
      <div {...handlers} className="relative cursor-crosshair touch-pan-y">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="block h-[280px] w-full"
        >
          <defs>
            <linearGradient id="compare-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={PALETTE.accent} stopOpacity="0.2" />
              <stop offset="1" stopColor={PALETTE.accent} stopOpacity="0" />
            </linearGradient>
          </defs>
          {GRID.map(level => {
            const y = BOX.y + BOX.height - level * BOX.height;
            return (
              <g key={level}>
                <line x1={GUTTER} x2={VIEW_W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" />
                <text
                  x={36}
                  y={y + 3.5}
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                  fill={PALETTE.faint}
                  textAnchor="end"
                >
                  {axis(max * level)}
                </text>
              </g>
            );
          })}
          <path
            d={linePath(prev, BOX, max)}
            fill="none"
            stroke={PALETTE.dim}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          <path d={areaPath(past, BOX, max)} fill="url(#compare-fill)" />
          <path
            d={linePath(past, BOX, max)}
            fill="none"
            stroke={PALETTE.accent}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {nowIndex < length - 1 && (
          <div
            className="pointer-events-none absolute inset-y-0 border-l border-accent/50"
            style={{ left: `${left(nowIndex)}%` }}
          >
            <span className="absolute -top-0.5 left-1.5 font-mono text-[10.5px] text-link">now</span>
          </div>
        )}
        {index !== null && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-fg/35"
              style={{ left: `${left(index)}%` }}
            />
            {(
              [
                [prev[index], PALETTE.dim],
                [past[index], PALETTE.accent]
              ] as const
            ).map(([value, color]) => {
              const y = top(value ?? null);
              return y === null ? null : (
                <span
                  key={color}
                  className="pointer-events-none absolute -mt-1.5 -ml-1.5 h-2 w-2 rounded-full border-2 border-card"
                  style={{ top: `${y}%`, left: `${left(index)}%`, background: color }}
                />
              );
            })}
            <div
              className="pointer-events-none absolute top-1.5 z-[3] flex min-w-[170px] flex-col gap-1.5 rounded-lg border border-white/10 bg-[#1f2430] px-[11px] py-[9px] shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
              style={{
                left: `${left(index)}%`,
                transform: left(index) > 60 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)'
              }}
            >
              <span className="font-mono text-[11px] text-muted">{labels[index] ?? ''}</span>
              <span className="flex items-center gap-[7px] text-xs text-fg-3">
                <span className="h-[7px] w-[7px] rounded-full bg-accent" />
                <span className="flex-1">{props.currentLabel}</span>
                <span className="font-mono text-fg">
                  {index <= nowIndex ? formatValue(metric, past[index] ?? null) : 'not yet'}
                </span>
              </span>
              <span className="flex items-center gap-[7px] text-xs text-fg-3">
                <span className="h-[7px] w-[7px] rounded-full bg-dim" />
                <span className="flex-1">{props.previousLabel}</span>
                <span className="font-mono text-fg">
                  {props.previousEmpty ? 'no data' : formatValue(metric, prev[index] ?? null)}
                </span>
              </span>
              {hoverDelta && hoverDelta.tone !== 'none' && (
                <span
                  className={cn(
                    'border-t border-white/8 pt-1.5 font-mono text-[11.5px]',
                    DELTA_TEXT[hoverDelta.tone]
                  )}
                >
                  {hoverDelta.text} vs {props.previousLabel.toLowerCase()}
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between pt-1.5 pl-11 font-mono text-[10.5px] text-faint">
        {props.xLabels.map(label => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
