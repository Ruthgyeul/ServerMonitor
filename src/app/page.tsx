'use client';

import React, { useEffect } from 'react';

import { Dashboard } from '@/components/dashboard/Dashboard';
import { useNow } from '@/hooks/useNow';
import { useSystemData } from '@/hooks/useSystemData';
import type { DashboardData } from '@/utils/dashboardData';

// 탭만 봐도 경보를 알 수 있도록, 지금 당장 문제가 있으면 문서 제목에 ⚠ 를 붙이고
// 파비콘을 빨간 점으로 바꾼다. 벽에 여러 탭을 띄워 두는 운용에서 유용하다.
const BASE_TITLE = 'Server Monitor';
const ALERT_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%23ef4444"/></svg>'
  );

function hasActiveAlert(data: DashboardData): boolean {
  return (
    data.cpu.usage > 85 ||
    data.memory.percentage > 90 ||
    data.disk.percentage > 90 ||
    (data.cpu.temperature !== 'N/A' && data.cpu.temperature > 74) ||
    (data.swap.total > 0 && data.swap.percentage > 80) ||
    data.security.firewall.status === 'inactive'
  );
}

export default function DisplayPage() {
  const { data, error, connected, lastUpdate, networkHistory, diskIoHistory } = useSystemData();
  const now = useNow();

  const alerting = data !== null && hasActiveAlert(data);

  useEffect(() => {
    document.title = alerting ? `⚠ ${BASE_TITLE}` : BASE_TITLE;

    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    // 원래 아이콘을 기억해 두었다가, 경보가 풀리면 되돌린다.
    const original = icon.dataset.original ?? icon.getAttribute('href') ?? '/favicon.svg';
    icon.dataset.original = original;
    icon.setAttribute('href', alerting ? ALERT_FAVICON : original);
  }, [alerting]);

  useEffect(() => {
    // 화면 잠김 방지
    const wakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.log('Wake lock failed:', err);
      }
    };
    wakeLock();
  }, []);

  if (data === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-gray-100">
        <StartupState error={error} />
      </div>
    );
  }

  return (
    <Dashboard
      data={data}
      connected={connected}
      lastUpdate={lastUpdate}
      now={now}
      networkHistory={networkHistory}
      diskIoHistory={diskIoHistory}
    />
  );
}

// 첫 응답을 받기 전에만 보인다. 한 번이라도 받은 뒤에는 연결이 끊겨도
// 마지막 값을 계속 띄우고, 헤더의 표시등으로 상태를 알린다.
const StartupState: React.FC<{ error: string | null }> = ({ error }) => (
  <div className="flex flex-col items-center justify-center gap-3 p-8">
    {error ? (
      <>
        <div className="text-sm font-bold text-red-400">Cannot reach /api/system</div>
        <div className="max-w-[600px] text-center text-xs text-gray-400">{error}</div>
      </>
    ) : (
      <>
        <div className="h-2 w-2 animate-[pulseDot_1s_ease-in-out_infinite] rounded-full bg-blue-400" />
        <div className="text-xs text-gray-400">Connecting to /api/system…</div>
      </>
    )}
  </div>
);
