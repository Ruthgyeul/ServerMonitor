import * as React from 'react';
import { Server } from 'lucide-react';

import { cn } from '@/lib/utils';

// Presentational chrome shared by the auth / loading / error screens so they read
// as the same "terminal window" the dashboard is wrapped in (see TerminalTitleBar
// and Header in src/components/dashboard/Dashboard.tsx). Pure markup, no hooks, so
// it works in both server and client components.

// The traffic-light dots + centered `root@host` path, matching the dashboard's
// title bar. host defaults to "server" since these screens have no host data yet.
export const TerminalTitleBar: React.FC<{ host?: string }> = ({ host = 'server' }) => (
  <div className="term-titlebar">
    <div className="flex shrink-0 items-center gap-[7px]">
      <span className="term-dot" style={{ background: '#ff5f56' }} />
      <span className="term-dot" style={{ background: '#ffbd2e' }} />
      <span className="term-dot" style={{ background: '#27c93f' }} />
    </div>
    <span className="min-w-0 flex-1 truncate text-center font-mono">
      <span style={{ color: '#34d399' }}>root@{host}</span>
      <span style={{ color: '#5c6478' }}> — ~/monitor — </span>
      <span style={{ color: '#8b93a7' }}>zsh</span>
    </span>
    <span className="shrink-0 font-mono text-gray-500">⎇ main</span>
  </div>
);

// The `Server ❯ Server Monitor` brand line, same composition as the dashboard header.
export const BrandLine: React.FC<{ subtitle?: string }> = ({ subtitle }) => (
  <div>
    <div className="flex items-center gap-2">
      <Server size={16} color="#38bdf8" strokeWidth={2} className="shrink-0" />
      <span className="t-value shrink-0 font-bold text-emerald-400 select-none">❯</span>
      <h1 className="t-value truncate font-bold">Server Monitor</h1>
    </div>
    {subtitle && <p className="t-micro mt-1 text-gray-400">{subtitle}</p>}
  </div>
);

interface TerminalWindowProps {
  /** Body padding class. Defaults to the dashboard card's rhythm. */
  className?: string;
  children: React.ReactNode;
}

// A framed terminal window: full-bleed title bar over a padded body, on the same
// card surface as the dashboard (bg-gray-800 / translucent border). The outer box
// deliberately avoids the `.dash-card` class so the title bar can sit flush to the
// top edge (that class forces its own padding).
export const TerminalWindow: React.FC<TerminalWindowProps> = ({ className, children }) => (
  <div className="w-full max-w-sm overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-[0_10px_28px_rgba(0,0,0,0.35)]">
    <TerminalTitleBar />
    <div className={cn('p-5', className)}>{children}</div>
  </div>
);

// Full-screen terminal backdrop that vertically/horizontally centers its child,
// matching the dashboard's `.terminal-bg` scanline + top-glow texture.
export const TerminalScreen: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children
}) => (
  <div
    className={cn(
      'terminal-bg flex min-h-screen w-full items-center justify-center p-4 text-gray-100',
      className
    )}
  >
    {children}
  </div>
);
