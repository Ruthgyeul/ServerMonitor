'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { KioskScreen } from '@/components/kiosk/KioskScreen';
import { useNow } from '@/hooks/useNow';
import { useSystemData } from '@/hooks/useSystemData';
import { useWakeLock } from '@/hooks/useWakeLock';

// Wall display for the 7" panel wired to this machine (and the console's Kiosk
// button). Point the kiosk browser (scripts/run.sh's KIOSK_URL) at this route
// through the loopback bypass port (KIOSK_BYPASS_ENABLED/KIOSK_BYPASS_PORT,
// see server.js + src/utils/apiAuth.ts) so it shows live data with no login.
// ?rotate=<seconds> sets the host↔cluster rotation (default 30s, 0 = off).

const DEFAULT_ROTATE_SECONDS = 30;

function rotateFromUrl(): number {
  if (typeof window === 'undefined') return DEFAULT_ROTATE_SECONDS;
  const raw = new URLSearchParams(window.location.search).get('rotate');
  const seconds = raw === null ? DEFAULT_ROTATE_SECONDS : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : DEFAULT_ROTATE_SECONDS;
}

export default function MonitorPage() {
  const router = useRouter();
  const { data, error, networkHistory, authRequired } = useSystemData();
  const now = useNow();

  useEffect(() => {
    if (authRequired) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  }, [authRequired]);

  // Keep the panel awake; released when leaving the kiosk.
  useWakeLock();

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    router.push('/');
  }, [router]);

  useEffect(() => {
    // ESC leaves the kiosk (a fullscreen browser spends the first ESC on
    // leaving fullscreen; the next one lands here).
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit]);

  if (data === null || now === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas text-sm text-muted">
        {error ? `Cannot reach the server — ${error}` : 'Connecting…'}
      </main>
    );
  }

  return (
    <KioskScreen
      data={data}
      networkHistory={networkHistory}
      now={now}
      initialEvery={rotateFromUrl()}
      onExit={exit}
    />
  );
}
