import React from 'react';

import { AlertBanner, currentAlerts } from '@/components/dashboard/AlertBanner';
import { CenterColumn } from '@/components/dashboard/CenterColumn';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { LeftColumn } from '@/components/dashboard/LeftColumn';
import { RightColumn } from '@/components/dashboard/RightColumn';
import { DiskIoPoint } from '@/hooks/useSystemData';
import { NetworkHistoryEntry } from '@/types/system';
import { DashboardData } from '@/utils/dashboardData';

// 7인치 키오스크 패널(1024x600) 전용 배치. 화면 크기가 달라져도 레이아웃을
// 다시 짜지 않고 캔버스째 확대/축소하므로, 어디서 열든 같은 그림이 나온다.
export const KIOSK_WIDTH = 1024;
export const KIOSK_HEIGHT = 600;

interface KioskDashboardProps {
  data: DashboardData;
  connected: boolean;
  lastUpdate: number | null;
  now: number | null;
  networkHistory: NetworkHistoryEntry[];
  diskIoHistory: DiskIoPoint[];
  scale: number;
}

export const KioskDashboard: React.FC<KioskDashboardProps> = ({
  data,
  connected,
  lastUpdate,
  now,
  networkHistory,
  diskIoHistory,
  scale
}) => (
  <div className="relative h-screen w-screen overflow-hidden bg-black">
    <div
      className="absolute left-1/2 top-1/2 flex flex-col overflow-hidden bg-gray-900 text-gray-100"
      style={{
        width: KIOSK_WIDTH,
        height: KIOSK_HEIGHT,
        transform: `translate(-50%, -50%) scale(${scale})`,
        transformOrigin: 'center center'
      }}
    >
      <DashboardHeader host={data.host} connected={connected} lastUpdate={lastUpdate} now={now} />
      <AlertBanner alerts={currentAlerts(data)} />

      <div className="flex min-h-0 flex-1 items-start gap-2 p-2">
        <LeftColumn data={data} diskIoHistory={diskIoHistory} />
        <CenterColumn data={data} networkHistory={networkHistory} />
        <RightColumn data={data} now={now} />
      </div>
    </div>
  </div>
);
