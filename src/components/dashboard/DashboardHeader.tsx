import React from 'react';
import { Server } from 'lucide-react';

import { HostInfo } from '@/types/system';
import { formatClock, shortKernel } from '@/utils/format';

interface DashboardHeaderProps {
  host: HostInfo;
  connected: boolean;
  lastUpdate: number | null;
  now: number | null;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ host, connected, lastUpdate, now }) => {
  const secondsAgo = now !== null && lastUpdate !== null ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : 0;

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-gray-700 bg-gray-800 px-3">
      <div className="flex min-w-0 items-center gap-[7px]">
        <Server size={16} color="#60a5fa" strokeWidth={2} />
        <h1 className="m-0 text-[14px] font-bold">Server Monitor</h1>
        <div className="h-[7px] w-[7px] animate-[pulseDot_2s_ease-in-out_infinite] rounded-full bg-green-400" />
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              connected
                ? 'animate-[pulseDot_2s_ease-in-out_infinite] bg-green-400'
                : 'animate-[pulseDot_0.6s_ease-in-out_infinite] bg-red-400'
            }`}
          />
          <span className={`text-[9.5px] ${connected ? 'text-gray-400' : 'text-red-400'}`}>
            {connected ? `Live · updated ${secondsAgo}s ago` : 'Reconnecting…'}
          </span>
        </div>

        <span className="whitespace-nowrap font-mono text-[10.5px] text-gray-500">
          {/* 배포판 이름을 못 읽으면 os 자체가 커널 문자열이라, 같은 값을 두 번 쓰지 않는다. */}
          {host.os.includes(shortKernel(host.kernel)) ? host.os : `${host.os} · ${shortKernel(host.kernel)}`}
        </span>

        <div className="whitespace-nowrap font-mono text-[12px] text-gray-300">
          {/* 마운트 전에는 시각을 그리지 않는다(하이드레이션 불일치 방지). */}
          {now === null ? ' ' : formatClock(new Date(now))}
        </div>
      </div>
    </div>
  );
};
