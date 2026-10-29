import React from 'react';
import { Server } from 'lucide-react';

// Full-screen centered card with the brand mark, for the root-level screens
// that render outside the console shell (error, 404, loading).
export function CenteredCard({
  title,
  body,
  children
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="box-border flex w-full max-w-[380px] flex-col gap-[18px] rounded-xl border border-line-strong bg-card px-7 py-[30px]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-accent/35 bg-brand-tile">
            <Server size={16} className="text-accent" />
          </div>
          <span className="text-[15px] font-semibold">ServerMonitor</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-[-0.015em]">{title}</h1>
          <p className="text-[13px] text-muted">{body}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export const primaryButton =
  'self-start rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-canvas hover:bg-link-hover';
