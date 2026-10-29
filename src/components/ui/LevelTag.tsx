import React from 'react';

import { LEVEL_STYLES } from '@/lib/statusColors';
import type { AlertLevel } from '@/types/system';

// CRIT / WARN / INFO / OK chip for an alert level.
export function LevelTag({ level }: { level: AlertLevel }) {
  const style = LEVEL_STYLES[level];
  return (
    <span
      className="mt-0.5 rounded-[3px] px-1.5 py-px font-mono text-[10px] whitespace-nowrap"
      style={{ color: style.fg, background: style.bg }}
    >
      {style.tag}
    </span>
  );
}
