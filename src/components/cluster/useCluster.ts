'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ClusterNode } from '@/components/cluster/clusterTypes';
import type { NetworkHistoryEntry } from '@/types/system';

// Polls the same-origin /api/cluster (the server fans out to the nodes, so node
// IPs never reach the browser) and keeps a short per-node throughput history.

const MAX_NETWORK_POINTS = 30;

export interface ClusterState {
  // null = before the first response, [] = the server has no nodes configured.
  nodes: ClusterNode[] | null;
  history: Record<string, NetworkHistoryEntry[]>;
}

export function useCluster(intervalMs: number): ClusterState {
  const [state, setState] = useState<ClusterState>({ nodes: null, history: {} });

  const refresh = useCallback(async () => {
    let received: ClusterNode[];
    try {
      const response = await fetch('/api/cluster', { cache: 'no-store' });
      if (response.status === 401) {
        // Full navigation on purpose so login can set the auth cookie; keep the
        // query string (e.g. ?node=) so a deep link survives the round-trip.
        const here = window.location.pathname + window.location.search;
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/login?next=${encodeURIComponent(here)}`;
        return;
      }
      if (!response.ok) return;
      received = ((await response.json()) as { nodes?: ClusterNode[] }).nodes ?? [];
    } catch {
      return; // keep the last value rather than blanking the screen
    }

    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setState(previous => {
      const history = { ...previous.history };
      for (const node of received) {
        if (!node.result.ok) continue;
        const point = {
          time,
          download: node.result.data.network?.download ?? 0,
          upload: node.result.data.network?.upload ?? 0
        };
        history[node.name] = [...(history[node.name] ?? []), point].slice(-MAX_NETWORK_POINTS);
      }
      return { nodes: received, history };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!cancelled) await refresh();
    };
    void start();
    const timer = setInterval(refresh, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return state;
}
