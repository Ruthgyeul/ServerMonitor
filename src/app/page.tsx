"use client";

import React, { useEffect } from 'react';

import { KioskDashboard, KIOSK_HEIGHT, KIOSK_WIDTH } from '@/components/dashboard/KioskDashboard';
import { ResponsiveDashboard } from '@/components/dashboard/ResponsiveDashboard';
import { useNow } from '@/hooks/useNow';
import { useSystemData } from '@/hooks/useSystemData';
import { useViewMode } from '@/hooks/useViewMode';

export default function DisplayPage() {
  const { data, error, connected, lastUpdate, networkHistory, diskIoHistory } = useSystemData();
  const now = useNow();
  const { mode, scale } = useViewMode(KIOSK_WIDTH, KIOSK_HEIGHT);

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

  // 뷰포트를 재기 전에는 어느 배치가 맞는지 알 수 없다. 한 프레임 잘못 그리고
  // 튀는 것보다, 배경만 깔고 기다리는 편이 낫다.
  if (mode === null || data === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-gray-100">
        <StartupState error={error} />
      </div>
    );
  }

  if (mode === 'responsive') {
    return (
      <ResponsiveDashboard
        data={data}
        connected={connected}
        lastUpdate={lastUpdate}
        now={now}
        networkHistory={networkHistory}
        diskIoHistory={diskIoHistory}
      />
    );
  }

  return (
    <KioskDashboard
      data={data}
      connected={connected}
      lastUpdate={lastUpdate}
      now={now}
      networkHistory={networkHistory}
      diskIoHistory={diskIoHistory}
      scale={scale}
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
