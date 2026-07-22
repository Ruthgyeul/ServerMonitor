import React from 'react';

import { cn } from '@/lib/utils';

// 대시보드 카드 안에서 반복되는 그래픽 조각들.
// 치수는 CSS 클래스(.dash-*)가 정하므로, 화면 밀도가 바뀌어도 여기는 그대로다.

interface GaugeProps {
  percentage: number;
  color: string;
  className?: string;
}

// 크기는 CSS(.dash-gauge)가 정한다. viewBox 로 그리면 화면 밀도에 따라
// 지름이 바뀌어도 선 두께가 같은 비율로 따라간다.
const GAUGE_BOX = 36;
const GAUGE_STROKE = 3.5;
const GAUGE_RADIUS = GAUGE_BOX / 2 - GAUGE_STROKE / 2 - 1.25;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

export const Gauge: React.FC<GaugeProps> = ({ percentage, color, className }) => {
  const filled = Math.max(0, Math.min(100, percentage));

  return (
    <svg viewBox={`0 0 ${GAUGE_BOX} ${GAUGE_BOX}`} className={cn('dash-gauge shrink-0 -rotate-90', className)}>
      <circle
        cx={GAUGE_BOX / 2}
        cy={GAUGE_BOX / 2}
        r={GAUGE_RADIUS}
        stroke="#374151"
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
  values: number[];
  color: string;
}

interface SparklineProps {
  series: SparklineSeries[];
  className?: string;
  emptyLabel?: string;
}

// 축도 눈금도 없는 추세선. 세로 축은 표시된 구간의 최댓값에 맞춰 자동으로 늘어난다.
export const Sparkline: React.FC<SparklineProps> = ({ series, className, emptyLabel = 'collecting…' }) => {
  const width = 200;
  const height = 34;
  const length = Math.max(...series.map(entry => entry.values.length), 0);

  if (length < 2) {
    return (
      <div className={cn('t-micro flex h-full items-center justify-center text-gray-500', className)}>
        {emptyLabel}
      </div>
    );
  }

  const max = Math.max(1, ...series.flatMap(entry => entry.values)) * 1.2;

  const path = (values: number[]) =>
    values
      .map((value, index) => {
        const x = (index / (length - 1)) * width;
        const y = height - (Math.max(0, Math.min(max, value)) / max) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-full w-full', className)}
    >
      {series.map(entry => (
        <path key={entry.key} d={path(entry.values)} fill="none" stroke={entry.color} strokeWidth={1.5} />
      ))}
    </svg>
  );
};
