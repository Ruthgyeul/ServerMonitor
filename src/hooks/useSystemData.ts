'use client';

import { useEffect, useState } from 'react';

import { NetworkHistoryEntry, ServerData } from '@/types/system';
import { DashboardData, toDashboardData } from '@/utils/dashboardData';

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

  useEffect(() => {
    // 폴링(초당 GET) 대신 연결 하나를 열어두고 서버가 밀어주는 SSE 를 구독한다.
    // EventSource 는 연결이 끊기면 자동으로 재연결하므로 별도 백오프가 필요 없다.
    const source = new EventSource('/api/system/stream');

    source.onopen = () => {
      setState(previous => ({ ...previous, connected: true, error: null }));
    };

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload: unknown = JSON.parse(event.data);
        assertServerData(payload);

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
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Error parsing system data:', error);
        // 파싱 실패는 연결 문제가 아니다. 마지막 값은 유지하고 에러만 표시한다.
        setState(previous => ({ ...previous, error: message }));
      }
    };

    source.onerror = () => {
      // 연결이 끊긴 상태. 마지막으로 받은 값은 지우지 않는다. 잠깐 끊겼다고
      // 화면이 비어버리면 벽에 걸어둔 대시보드로서는 오히려 정보가 줄어든다.
      // EventSource 가 알아서 재연결을 시도하며, 성공하면 onopen 이 복구한다.
      setState(previous => ({ ...previous, connected: false }));
    };

    return () => {
      source.close();
    };
  }, []);

  return state;
}
