'use client';

import { useEffect } from 'react';
import { FallbackProps } from 'react-error-boundary';

import { BrandLine, TerminalScreen, TerminalWindow } from '@/components/common/TerminalWindow';

export default function Error({ error, resetErrorBoundary }: FallbackProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <TerminalScreen>
      <TerminalWindow>
        <div className="flex flex-col gap-4">
          <BrandLine subtitle="The dashboard hit an unexpected error." />
          <div className="flex items-start gap-1.5 font-mono text-sm text-red-400">
            <span aria-hidden>▸</span>
            <span className="min-w-0 break-words">Something went wrong.</span>
          </div>
          <button
            onClick={resetErrorBoundary}
            className="self-start rounded-md bg-[#38bdf8] px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-[#7dd3fc]"
          >
            Try again
          </button>
        </div>
      </TerminalWindow>
    </TerminalScreen>
  );
}
