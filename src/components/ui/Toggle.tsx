'use client';

import React from 'react';

import { cn } from '@/lib/utils';

// Pill switch (36×20): accent track when on, knob slides right.
export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'box-border flex h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-200',
        on ? 'justify-end bg-accent' : 'justify-start bg-toggle-off'
      )}
    >
      <span className="h-4 w-4 rounded-full bg-white" />
    </button>
  );
}
