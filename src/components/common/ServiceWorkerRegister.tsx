'use client';

import { useEffect } from 'react';

// Registers the no-op service worker (public/sw.js) so the dashboard is
// installable as a PWA. Mounted once from the root layout; renders nothing.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability is a nice-to-have, not a hard requirement — never
        // let a registration failure (e.g. served over plain HTTP) break the app.
      });
    }
  }, []);

  return null;
}
