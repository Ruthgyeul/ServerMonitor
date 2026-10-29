'use client';

import React from 'react';

import { cn } from '@/lib/utils';

// Compact option picker (range 1h/6h/24h/7d, sort CPU/MEM, filters).

interface SegmentedProps<T extends string | number> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'xs';
  label?: string;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'sm',
  label
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex border border-line bg-sidebar',
        size === 'sm' ? 'rounded-md p-0.5' : 'rounded-[5px] p-px'
      )}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'font-mono',
              size === 'sm' ? 'rounded px-2 py-0.5 text-[11px]' : 'rounded-[3px] px-[5px] py-px text-[10px]',
              active ? 'bg-active text-fg' : 'text-subtle hover:text-fg-2'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Turns plain labels into Segmented options.
export function optionsOf<T extends string | number>(values: readonly T[]): { value: T; label: string }[] {
  return values.map(value => ({ value, label: String(value) }));
}
