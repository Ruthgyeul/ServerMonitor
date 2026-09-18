import React from 'react';

import { cn } from '@/lib/utils';

// Graphic pieces reused inside the dashboard cards.
// Dimensions come from CSS classes (.dash-*), so these stay the same as screen density changes.

interface GaugeProps {
  percentage: number;
  color: string;
  className?: string;
  // Screen-reader label. A hand-drawn SVG reads nothing by default, so provide
  // it together with role="img". If unset, at least the percentage is read.
  ariaLabel?: string;
}

// Size comes from CSS (.dash-gauge). Drawing with a viewBox keeps the stroke
// width in the same proportion even as the diameter changes with screen density.
const GAUGE_BOX = 36;
const GAUGE_STROKE = 3.5;
const GAUGE_RADIUS = GAUGE_BOX / 2 - GAUGE_STROKE / 2 - 1.25;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

export const Gauge: React.FC<GaugeProps> = ({ percentage, color, className, ariaLabel }) => {
  const filled = Math.max(0, Math.min(100, percentage));

  return (
    <svg
      viewBox={`0 0 ${GAUGE_BOX} ${GAUGE_BOX}`}
      className={cn('dash-gauge shrink-0 -rotate-90', className)}
      role="img"
      aria-label={ariaLabel ?? `${Math.round(filled)}%`}
    >
      <circle
        cx={GAUGE_BOX / 2}
        cy={GAUGE_BOX / 2}
        r={GAUGE_RADIUS}
        stroke="#242b3a"
        strokeWidth={GAUGE_STROKE}
        fill="transparent"
      />
      <circle
        cx={GAUGE_BOX / 2}
        cy={GAUGE_BOX / 2}
        r={GAUGE_RADIUS}
        stroke={color}
        strokeWidth={GAUGE_STROKE}
        fill="transparent"
        strokeDasharray={GAUGE_CIRCUMFERENCE}
        strokeDashoffset={GAUGE_CIRCUMFERENCE - (filled / 100) * GAUGE_CIRCUMFERENCE}
      />
    </svg>
  );
};

interface BarProps {
  percentage: number;
  color: string;
  className?: string;
  children?: React.ReactNode;
}

export const Bar: React.FC<BarProps> = ({ percentage, color, className, children }) => (
  <div className={cn('relative h-[5px] rounded-[3px] bg-gray-900', className)}>
    <div
      className="h-full rounded-[3px]"
      style={{ width: `${Math.max(0, Math.min(100, percentage))}%`, background: color }}
    />
    {children}
  </div>
);

interface SparklineSeries {
  key: string;
  // null entries are gaps (the metric was unavailable that slot) — the line
  // breaks there rather than interpolating across the missing time.
  values: (number | null)[];
  color: string;
}

interface SparklineProps {
  series: SparklineSeries[];
  className?: string;
  emptyLabel?: string;
}

// A trend line with no axes or ticks. The vertical axis auto-scales to the max of the shown range.
export const Sparkline: React.FC<SparklineProps> = ({ series, className, emptyLabel = 'collecting…' }) => {
  const width = 200;
  const height = 34;
  const length = Math.max(...series.map(entry => entry.values.length), 0);

  // Need at least two real (non-null) points somewhere to draw a line.
  const realCount = series.reduce(
    (total, entry) => total + entry.values.filter((value): value is number => value !== null).length,
    0
  );
  if (length < 2 || realCount < 2) {
    return (
      <div className={cn('t-micro flex h-full items-center justify-center text-gray-500', className)}>
        {emptyLabel}
      </div>
    );
  }

  const reals = series.flatMap(entry => entry.values.filter((value): value is number => value !== null));
  const max = Math.max(1, ...reals) * 1.2;

  // Keep each point at its true x-position (by index) and start a new sub-path
  // after a gap, so missing slots read as breaks rather than compressing time.
  const path = (values: (number | null)[]) => {
    let d = '';
    let penDown = false;
    values.forEach((value, index) => {
      if (value === null) {
        penDown = false;
        return;
      }
      const x = (index / (length - 1)) * width;
      const y = height - (Math.max(0, Math.min(max, value)) / max) * height;
      d += `${penDown ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
      penDown = true;
    });
    return d.trim();
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-full w-full', className)}
      role="img"
      aria-label={`trend of ${series.map(entry => entry.key).join(', ')}`}
    >
      {series.map(entry => (
        <path key={entry.key} d={path(entry.values)} fill="none" stroke={entry.color} strokeWidth={1.5} />
      ))}
    </svg>
  );
};
