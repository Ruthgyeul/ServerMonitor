import type { DashboardData } from '@/utils/dashboardData';
import { formatTimestamp } from '@/utils/timeFormat';

// Download the current sample as pretty-printed JSON, named after the moment it
// was taken ("servermonitor-2026-10-29-14-03-07.json").
export function downloadSnapshot(data: DashboardData, at: number): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `servermonitor-${formatTimestamp(at).replace(/[: ]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
