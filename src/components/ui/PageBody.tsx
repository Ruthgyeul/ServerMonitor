import React from 'react';

import { cn } from '@/lib/utils';

// Content column under the console header: shared gutters and max width.
export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'box-border flex w-full max-w-[1600px] flex-col gap-4 px-4 pt-5 pb-10 desk:px-7',
        className
      )}
    >
      {children}
    </div>
  );
}

// A wrapping row of panels; children size themselves with flex-basis.
export function PanelRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-stretch gap-4">{children}</div>;
}
