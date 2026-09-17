'use client';

import { useEffect } from 'react';

// Kiosk auto-rotation: with `?rotate=<seconds>` in the URL, a wall panel cycles
// between the dashboard and the cluster view (and back) on that interval,
// carrying the rotate param along so it keeps going. No param = no rotation, so
// a normal browser session is unaffected.
//
// `home` lets a page other than `/` declare itself the return point of the
// cycle (e.g. /monitor rotating to /cluster and back, rather than ending up
// on the ordinary dashboard). It's carried in the URL as `?home=`, and
// `useKioskRotateHome` below reads it back on the other side.
export function useKioskRotate(nextPath: string, home?: string): void {
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
        if (home) target.searchParams.set('home', home);
        window.location.href = target.toString();
      },
      Math.max(3, seconds) * 1000
    );
    return () => clearTimeout(timer);
  }, [nextPath, home]);
}

// For a page whose own rotation target should follow whichever page started
// the cycle (e.g. /cluster normally rotates back to `/`, but should return to
// `/monitor` when that's where the cycle came from) rather than a hardcoded
// default. Reads the `home` query param a page may have been reached with;
// falls back to `fallback` when absent (a normal, non-kiosk visit).
export function useKioskRotateHome(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    return new URLSearchParams(window.location.search).get('home') || fallback;
  } catch {
    return fallback;
  }
}
