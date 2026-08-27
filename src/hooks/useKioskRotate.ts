'use client';

import { useEffect } from 'react';

// Kiosk auto-rotation: with `?rotate=<seconds>` in the URL, a wall panel cycles
// between the dashboard and the cluster view (and back) on that interval,
// carrying the rotate param along so it keeps going. No param = no rotation, so
// a normal browser session is unaffected.
export function useKioskRotate(nextPath: string): void {
  useEffect(() => {
    let seconds = 0;
    try {
      seconds = Number(new URLSearchParams(window.location.search).get('rotate')) || 0;
    } catch {
      seconds = 0;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    const timer = setTimeout(
      () => {
        const target = new URL(nextPath, window.location.origin);
        target.searchParams.set('rotate', String(seconds));
        window.location.href = target.toString();
      },
      Math.max(3, seconds) * 1000
    );
    return () => clearTimeout(timer);
  }, [nextPath]);
}
