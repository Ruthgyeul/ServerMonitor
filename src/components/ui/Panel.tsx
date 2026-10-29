import React from 'react';

import { cn } from '@/lib/utils';

// The console card: rounded surface with an optional header row (title on the
// left, `actions` on the right). `className` sizes it inside its row.

interface PanelProps {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  // Extra classes for the header row (e.g. tighter gaps).
  headerClassName?: string;
  tone?: 'default' | 'alert' | 'warn';
  children?: React.ReactNode;
}

const TONE_BORDER = {
  default: 'border-line',
  alert: 'border-crit/30',
  warn: 'border-warn/30'
} as const;

export function Panel({
  title,
  actions,
  className,
  headerClassName,
  tone = 'default',
  children
}: PanelProps) {
  return (
    <section className={cn('min-w-0 rounded-[10px] border bg-card', TONE_BORDER[tone], className)}>
      {title !== undefined && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-white/5 px-[18px] py-3.5',
            headerClassName
          )}
        >
          <h2 className="flex-1 text-[13.5px] font-medium">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// A row of labelled figures across the bottom of a panel.
export function StatCells({
  stats,
  min = 120
}: {
  stats: { label: string; value: React.ReactNode }[];
  min?: number;
}) {
  return (
    <div
      className="grid border-t border-white/5"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}
    >
      {stats.map(stat => (
        <div key={stat.label} className="flex flex-col gap-[3px] border-r border-white/5 px-[18px] py-3">
          <span className="text-[11.5px] text-subtle">{stat.label}</span>
          <span className="font-mono text-sm">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}
