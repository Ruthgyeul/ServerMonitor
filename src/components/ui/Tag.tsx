import React from 'react';

import { cn } from '@/lib/utils';

// Small monospace status chip. `tone` picks the tinted palette.
export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok-fg',
  warn: 'bg-warn/12 text-warn-fg',
  crit: 'bg-crit/14 text-crit-fg',
  info: 'bg-accent/12 text-info-fg',
  neutral: 'bg-white/6 text-fg-3'
};

export function Tag({
  tone,
  className,
  children
}: {
  tone: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'rounded px-[7px] py-0.5 font-mono text-[11px] whitespace-nowrap',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
