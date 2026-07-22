'use client';

import { useEffect, useRef, useState } from 'react';

import { NetworkHistoryEntry, ServerData } from '@/types/system';
import { DashboardData, toDashboardData } from '@/utils/dashboardData';

const POLL_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 4000;
const MAX_POINTS = 60;

// 이 필드들이 없으면 응답이 /api/system 의 것이 아니거나 심하게 망가진 것이다.
const REQUIRED_FIELDS = ['cpu', 'memory', 'disk', 'network', 'uptime', 'temperature', 'fan', 'processes'] as const;

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

  // 응답이 폴링 간격보다 느려지면 요청이 겹쳐 쌓인다. 한 번에 하나만 보낸다.
  const inflight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      if (inflight.current) return;
      inflight.current = true;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch('/api/system', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to fetch system data (${response.status})`);

        const payload: unknown = await response.json();
        assertServerData(payload);
        if (cancelled) return;

        const data = toDashboardData(payload);
        const time = new Date().toLocaleTimeString('ko-KR', {
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
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Error fetching system data:', error);

        // 마지막으로 받은 값은 지우지 않는다. 잠깐 끊겼다고 화면이 비어버리면
        // 벽에 걸어둔 대시보드로서는 오히려 정보가 줄어든다.
        setState(previous => ({ ...previous, error: message, connected: false }));
      } finally {
        clearTimeout(timeout);
        inflight.current = false;
      }
    };

    fetchOnce();
    const interval = setInterval(fetchOnce, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return state;
}
