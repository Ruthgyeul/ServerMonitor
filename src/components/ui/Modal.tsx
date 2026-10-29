'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

// Centered dialog on a dimmed backdrop. Closes on backdrop click and Escape.

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  // Extra header content between the title and the close button.
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Modal({ title, onClose, aside, className, children }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[46] flex items-center justify-center bg-[rgba(5,6,9,0.7)] p-5"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={event => event.stopPropagation()}
        className={cn(
          'w-full max-w-[460px] rounded-xl border border-white/10 bg-raised shadow-[0_24px_60px_rgba(0,0,0,0.6)]',
          className
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <span className="flex-1 text-[15px] font-semibold">{title}</span>
          {aside}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-white/6 hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
