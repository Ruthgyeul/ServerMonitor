'use client';

import React, { createContext, useContext, useEffect } from 'react';

import { useSystemData, type SystemDataHandle } from '@/hooks/useSystemData';

// One SSE subscription for the whole console. The shell (sidebar badges, bell,
// offline banner) and every page read the same stream through this context
// instead of each opening its own EventSource.

const SystemDataContext = createContext<SystemDataHandle | null>(null);

export function SystemDataProvider({ children }: { children: React.ReactNode }) {
  const value = useSystemData();

  useEffect(() => {
    // The API is token-gated and this browser has no valid cookie. A full
    // navigation on purpose: leave the (data-less, gated) SPA entirely so the
    // login page can set the auth cookie the stream needs. Keep the query
    // string so deep-link params survive the login round-trip.
    if (value.authRequired) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${next}`;
    }
  }, [value.authRequired]);

  return <SystemDataContext.Provider value={value}>{children}</SystemDataContext.Provider>;
}

export function useSystem(): SystemDataHandle {
  const value = useContext(SystemDataContext);
  if (!value) throw new Error('useSystem must be used inside <SystemDataProvider>');
  return value;
}
