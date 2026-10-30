'use client';

import { useEffect } from 'react';

// Keep the screen awake while the calling page is mounted (wall displays). The
// browser drops the lock whenever the tab is hidden, so it's requested again
// when the page becomes visible; it's released when the page goes away.
// Refusals (unsupported, hidden tab, battery saver) leave the display on its
// own timeout.
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let left = false;

    const request = () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      navigator.wakeLock
        .request('screen')
        .then(sentinel => {
          if (left) void sentinel.release();
          else lock = sentinel;
        })
        .catch(() => {});
    };

    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      left = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => {});
    };
  }, []);
}
