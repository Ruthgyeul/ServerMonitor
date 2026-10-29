'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useSystem } from '@/components/providers/SystemDataProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { LogDrawer, type LogSource } from '@/components/logs/LogDrawer';
import { CustomizeModal } from '@/components/overview/CustomizeModal';
import { ConnectError } from '@/components/shell/ConnectError';
import { Header, type LinkState } from '@/components/shell/Header';
import { OfflineBanner } from '@/components/shell/OfflineBanner';
import { PageSkeleton } from '@/components/shell/PageSkeleton';
import { ShellActionsContext } from '@/components/shell/ShellActions';
import { Sidebar } from '@/components/shell/Sidebar';
import { pageMeta } from '@/components/shell/navigation';
import { downloadSnapshot } from '@/components/shell/snapshot';
import { useAlertNotifications } from '@/hooks/useAlertNotifications';
import { useAlertTabIndicator } from '@/hooks/useAlertTabIndicator';
import { useNow } from '@/hooks/useNow';

// The console frame around every authenticated page: sidebar, sticky header,
// offline banner, and the loading / unreachable states before the first sample.

// The stream ticks every second while a viewer is connected.
const STALE_AFTER_SECONDS = 10;

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, connected, lastUpdate, error, reconnect } = useSystem();
  const now = useNow();
  const flash = useToast();
  const [navOpen, setNavOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [logSource, setLogSource] = useState<LogSource | null>(null);
  const actions = useMemo(
    () => ({
      openCustomize: () => setCustomizeOpen(true),
      openLogs: (source: LogSource) => setLogSource(source)
    }),
    []
  );
  const notify = useAlertNotifications(data?.alerts ?? []);

  useAlertTabIndicator((data?.activeAlerts.length ?? 0) > 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNavOpen(false);
      setBellOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeNav = useCallback(() => setNavOpen(false), []);

  const meta = pageMeta(pathname, data?.host.hostname ?? '—');
  const staleSeconds =
    now !== null && lastUpdate !== null ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : 0;
  // A stream can stay open while samples stop arriving (stalled collector,
  // half-dead proxy), so silence counts as offline too.
  const offline = data !== null && (!connected || staleSeconds > STALE_AFTER_SECONDS);
  let link: LinkState = offline ? 'reconnecting' : 'live';
  if (data === null) link = error ? 'down' : 'connecting';

  const onOverview = pathname === '/';
  const exportSnapshot =
    onOverview && data
      ? () => {
          downloadSnapshot(data, Date.now());
          flash('Snapshot downloaded');
        }
      : undefined;

  const retry = () => {
    reconnect();
    flash('Reconnecting…');
  };

  let content: React.ReactNode = children;
  if (data === null) {
    content = error ? (
      <ConnectError message={error} onRetry={retry} />
    ) : (
      <PageSkeleton what={meta.title.toLowerCase()} />
    );
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar open={navOpen} onClose={closeNav} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Header
          meta={meta}
          now={now}
          link={link}
          staleSeconds={staleSeconds}
          mute={data?.mute ?? null}
          alerts={data?.alerts ?? []}
          activeCount={data?.activeAlerts.length ?? 0}
          bellOpen={bellOpen}
          onToggleBell={() => setBellOpen(open => !open)}
          onCloseBell={() => setBellOpen(false)}
          soundEnabled={notify.enabled}
          onToggleSound={notify.toggle}
          onOpenNav={() => setNavOpen(true)}
          onExport={exportSnapshot}
          onCustomize={onOverview ? actions.openCustomize : undefined}
        />
        {offline && lastUpdate !== null && now !== null && (
          <OfflineBanner lastUpdate={lastUpdate} now={now} onRetry={retry} />
        )}
        <ShellActionsContext.Provider value={actions}>{content}</ShellActionsContext.Provider>
      </main>
      {customizeOpen && onOverview && <CustomizeModal onClose={() => setCustomizeOpen(false)} />}
      {logSource && (
        <LogDrawer
          key={`${logSource.kind}:${logSource.name}`}
          source={logSource}
          onClose={() => setLogSource(null)}
        />
      )}
    </div>
  );
}
