'use client';

import { useCallback, useSyncExternalStore } from 'react';

// A localStorage-backed string, read through useSyncExternalStore so the server
// render (and the hydration pass) sees `null` and the client switches to the
// stored value without a mismatch warning. Writes notify every subscriber in
// this tab; the native `storage` event covers other tabs. Storage failures
// (private mode, blocked site data) degrade to "nothing stored".

const LOCAL_EVENT = 'sm-storage';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useStoredString(key: string): [string | null, (value: string | null) => void] {
  const subscribe = useCallback(
    (notify: () => void) => {
      const onChange = (event: Event) => {
        if (!(event instanceof StorageEvent) || event.key === key) notify();
      };
      window.addEventListener('storage', onChange);
      window.addEventListener(LOCAL_EVENT, onChange);
      return () => {
        window.removeEventListener('storage', onChange);
        window.removeEventListener(LOCAL_EVENT, onChange);
      };
    },
    [key]
  );

  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  );

  const write = useCallback(
    (next: string | null) => {
      try {
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {
        /* storage unavailable — the value just won't persist */
      }
      window.dispatchEvent(new Event(LOCAL_EVENT));
    },
    [key]
  );

  return [value, write];
}
