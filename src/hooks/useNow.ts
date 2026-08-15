'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Baking the time into the server render causes a hydration mismatch. The
// server snapshot is null (the screen draws a placeholder) and only the client
// streams the real time.
//
// Subscribe via an external store instead of calling setState inside an effect.
// That avoids an extra render right after hydration, and hooks using the same
// interval share a single timer.

interface Ticker {
  now: number;
  listeners: Set<() => void>;
  handle: ReturnType<typeof setInterval> | null;
}

const tickers = new Map<number, Ticker>();

function tickerFor(intervalMs: number): Ticker {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    ticker = { now: Date.now(), listeners: new Set(), handle: null };
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

export function useNow(intervalMs = 1000): number | null {
  // Grab the ticker only inside the callback. Pulling it out during render would
  // be flagged as "mutating a value created during render" (react-hooks/immutability), so we don't.
  const subscribe = useCallback(
    (listener: () => void) => {
      const ticker = tickerFor(intervalMs);

      // A long-idle ticker has a stale cached time. Sync it once at subscribe time.
      // React re-reads the snapshot right after subscribing to reflect the changed value.
      ticker.now = Date.now();
      ticker.listeners.add(listener);

      // Start the timer only on the first subscriber, and stop it when the last one leaves.
      if (!ticker.handle) {
        ticker.handle = setInterval(() => {
          ticker.now = Date.now();
          for (const notify of ticker.listeners) notify();
        }, intervalMs);
      }

      return () => {
        ticker.listeners.delete(listener);
        if (ticker.listeners.size === 0 && ticker.handle) {
          clearInterval(ticker.handle);
          ticker.handle = null;
        }
      };
    },
    [intervalMs]
  );

  // getSnapshot must return the same value while nothing changes (otherwise an
  // infinite render). So it reads the ticker's cached value rather than calling Date.now() directly.
  const getSnapshot = useCallback(() => tickerFor(intervalMs).now, [intervalMs]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
