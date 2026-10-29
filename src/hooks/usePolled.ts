'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Shared polling for `{ success, data }` JSON endpoints. Every component asking
// for the same url shares one request loop (so four KPI cards on the same range
// cost one fetch), which starts with the first subscriber and stops with the
// last. Keeps the last good value across failed polls; null until the first
// success. Pass a null url to pause.

interface Envelope<T> {
  success: boolean;
  data?: T;
}

interface Entry {
  data: unknown;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const entries = new Map<string, Entry>();

function entryFor(url: string): Entry {
  let entry = entries.get(url);
  if (!entry) {
    entry = { data: null, listeners: new Set(), timer: null };
    entries.set(url, entry);
  }
  return entry;
}

function load(url: string, entry: Entry): void {
  fetch(url, { cache: 'no-store' })
    .then(response => (response.ok ? (response.json() as Promise<Envelope<unknown>>) : null))
    .then(body => {
      if (!body?.success || body.data === undefined) return;
      entry.data = body.data;
      entry.listeners.forEach(notify => notify());
    })
    .catch(() => {
      /* keep the last value; the next poll retries */
    });
}

// Drop the cached value and refetch now (after a write the caller knows changed it).
export function refreshPolled(url: string): void {
  const entry = entries.get(url);
  if (entry) load(url, entry);
}

export function usePolled<T>(url: string | null, intervalMs: number): T | null {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (url === null) return () => {};
      const entry = entryFor(url);
      entry.listeners.add(notify);
      if (entry.timer === null) {
        load(url, entry);
        entry.timer = setInterval(() => load(url, entry), intervalMs);
      }
      return () => {
        entry.listeners.delete(notify);
        if (entry.listeners.size === 0 && entry.timer !== null) {
          clearInterval(entry.timer);
          entry.timer = null;
        }
      };
    },
    [url, intervalMs]
  );

  return useSyncExternalStore(
    subscribe,
    () => (url === null ? null : ((entries.get(url)?.data as T | undefined) ?? null)),
    () => null
  );
}
