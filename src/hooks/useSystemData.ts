'use client';

import { useEffect, useState } from 'react';

import { NetworkHistoryEntry, ServerData } from '@/types/system';
import { DashboardData, toDashboardData } from '@/utils/dashboardData';

const MAX_POINTS = 60;

// Without these fields the response either isn't from /api/system or is badly broken.
const REQUIRED_FIELDS = [
  'cpu',
  'memory',
  'disk',
  'network',
  'uptime',
  'temperature',
  'fan',
  'processes'
] as const;

export interface DiskIoPoint {
  read: number;
  write: number;
}

export interface SystemDataState {
  data: DashboardData | null;
  error: string | null;
  connected: boolean;
  lastUpdate: number | null;
  networkHistory: NetworkHistoryEntry[];
  diskIoHistory: DiskIoPoint[];
}

function assertServerData(payload: unknown): asserts payload is ServerData {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid data format received');
  }

  const record = payload as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter(field => !record[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

export function useSystemData(): SystemDataState {
  const [state, setState] = useState<SystemDataState>({
    data: null,
    error: null,
    connected: false,
    lastUpdate: null,
    networkHistory: [],
    diskIoHistory: []
  });

  useEffect(() => {
    // Instead of polling (a GET per second), keep one connection open and
    // subscribe to the SSE the server pushes. EventSource auto-reconnects on drop, so no separate backoff is needed.
    const source = new EventSource('/api/system/stream');

    source.onopen = () => {
      setState(previous => ({ ...previous, connected: true, error: null }));
    };

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload: unknown = JSON.parse(event.data);
        assertServerData(payload);

        const data = toDashboardData(payload);
        const time = new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        setState(previous => ({
          data,
          error: null,
          connected: true,
          lastUpdate: Date.now(),
          networkHistory: [
            ...previous.networkHistory,
            { time, download: data.network.download, upload: data.network.upload }
          ].slice(-MAX_POINTS),
          diskIoHistory: [
            ...previous.diskIoHistory,
            { read: data.diskIO.read, write: data.diskIO.write }
          ].slice(-MAX_POINTS)
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Error parsing system data:', error);
        // A parse failure isn't a connection problem. Keep the last value and just show the error.
        setState(previous => ({ ...previous, error: message }));
      }
    };

    source.onerror = () => {
      // Disconnected. Don't clear the last received value. If the screen went
      // blank on a brief drop, a wall-mounted dashboard would actually show less
      // info. EventSource retries reconnection on its own, and onopen restores things on success.
      setState(previous => ({ ...previous, connected: false }));
    };

    return () => {
      source.close();
    };
  }, []);

  return state;
}
