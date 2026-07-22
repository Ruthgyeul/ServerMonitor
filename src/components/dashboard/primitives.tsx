import React from 'react';
import { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

// 1024x600 캔버스에 맞춘 공통 조각들. 치수(7px 라운드, 9px 라벨 등)는
// 디자인 시안 그대로다.

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Panel: React.FC<PanelProps> = ({ className, children, ...props }) => (
  <div
    className={cn('box-border rounded-[7px] border border-gray-700 bg-gray-800', className)}
    {...props}
  >
    {children}
  </div>
);

interface PanelTitleProps {
  icon: LucideIcon;
  color: string;
  label: string;
  right?: React.ReactNode;
  className?: string;
}

export const PanelTitle: React.FC<PanelTitleProps> = ({ icon: Icon, color, label, right, className }) => (
  <div className={cn('flex items-center justify-between gap-1.5', className)}>
    <div className="flex min-w-0 items-center gap-[5px]">
      <Icon size={12} color={color} strokeWidth={2} className="shrink-0" />
      <span className="whitespace-nowrap text-[9px] tracking-[0.03em] text-gray-300">{label}</span>
    </div>
    {right}
  </div>
);

interface GaugeProps {
  percentage: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}

export const Gauge: React.FC<GaugeProps> = ({ percentage, color, size = 36, strokeWidth = 3.5 }) => {
  const radius = size / 2 - strokeWidth / 2 - 1.25;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, percentage));

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#374151" strokeWidth={strokeWidth} fill="transparent" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="transparent"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (filled / 100) * circumference}
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
      <div className={cn('flex items-center justify-center text-[8px] text-gray-500', className)}>
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

// 값이 없는 카드가 통째로 접히지 않도록 자리를 잡아주는 한 줄.
export const EmptyRow: React.FC<{ children?: React.ReactNode }> = ({ children = 'no data' }) => (
  <div className="text-[9.5px] text-gray-500">{children}</div>
);
