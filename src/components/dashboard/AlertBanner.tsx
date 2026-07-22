import React from 'react';
import { TriangleAlert } from 'lucide-react';

import { DashboardData } from '@/utils/dashboardData';

// 배너에 띄울 만한 "지금 당장 문제" 만 고른다. 지나간 사건은 우측 ALERTS LOG 가 맡는다.
export function currentAlerts(data: DashboardData): string[] {
  const alerts: string[] = [];

  if (data.cpu.usage > 85) alerts.push(`CPU ${data.cpu.usage.toFixed(1)}%`);
  if (data.memory.percentage > 90) alerts.push(`RAM ${data.memory.percentage.toFixed(1)}%`);
  if (data.disk.percentage > 90) alerts.push(`Disk ${data.disk.percentage.toFixed(1)}%`);
  if (data.cpu.temperature !== 'N/A' && data.cpu.temperature > 74) {
    alerts.push(`Temp ${data.cpu.temperature.toFixed(1)}°C`);
  }
  if (data.swap.total > 0 && data.swap.percentage > 80) alerts.push('Swap high');
  if (data.security.firewall.status === 'inactive') alerts.push('Firewall inactive');

  return alerts;
}

interface AlertBannerProps {
  alerts: string[];
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ alerts }) => {
  const hasAlert = alerts.length > 0;
  const color = hasAlert ? '#f87171' : '#4ade80';

  return (
    <div
      className={`flex h-[22px] shrink-0 items-center gap-1.5 border-b border-gray-700 px-3 ${
        hasAlert ? 'animate-[alertBlink_1.2s_ease-in-out_infinite]' : ''
      }`}
      style={{ background: hasAlert ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.08)' }}
    >
      <TriangleAlert size={12} color={color} strokeWidth={2} className="shrink-0" />
      <span className="truncate text-[11px]" style={{ color }}>
        {hasAlert ? `Warning: ${alerts.join(' · ')}` : 'All systems normal'}
      </span>
    </div>
  );
};
