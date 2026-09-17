'use client';

import { useEffect, useState } from 'react';

export interface DailyBandwidth {
  date: string;
  downloadMB: number;
  uploadMB: number;
}

// Monthly bandwidth is a slow-changing number, so it's polled on its own,
// far less often than the 1s SSE stream the rest of the dashboard rides on
// (see /api/bandwidth's own comment for why it's a separate endpoint).
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useBandwidthHistory(days: number = 30): { days: DailyBandwidth[] | null } {
  const [data, setData] = useState<DailyBandwidth[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch(`/api/bandwidth?days=${days}`, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { days: DailyBandwidth[] };
        if (!cancelled) setData(payload.days);
      } catch {
        // Keep the last known value on a transient network error.
      }
    };

    void refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [days]);

  return { days: data };
}
