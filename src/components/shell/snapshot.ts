import type { DashboardData } from '@/utils/dashboardData';
import { formatTimestamp } from '@/utils/timeFormat';

// The JSON snapshot behind the overview's Export button: the headline numbers,
// what's alerting and what's running — small enough to paste into a ticket.
export interface Snapshot {
  host: string;
  at: string; // ISO 8601
  cpu: number;
  memory: number;
  disk: number;
  temperature: number | null;
  loadPerCore: number | null;
  network: { downloadKBs: number; uploadKBs: number };
  activeAlerts: string[];
  containers: { name: string; image: string; state: string }[];
  failedUnits: string[];
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

// Pure: the snapshot for one sample.
export function buildSnapshot(data: DashboardData, at: number): Snapshot {
  const temperature = data.cpu.temperature;
  return {
    host: data.host.hostname,
    at: new Date(at).toISOString(),
    cpu: round(data.cpu.usage, 1),
    memory: round(data.memory.percentage, 1),
    disk: round(data.disk.percentage, 1),
    temperature: typeof temperature === 'number' ? round(temperature, 1) : null,
    loadPerCore: data.cpu.cores > 0 ? round(data.load.avg1 / data.cpu.cores, 2) : null,
    network: { downloadKBs: round(data.network.download, 2), uploadKBs: round(data.network.upload, 2) },
    activeAlerts: data.activeAlerts.map(alert => alert.short ?? alert.message),
    containers: data.docker.containers.map(({ name, image, state }) => ({ name, image, state })),
    failedUnits: data.services.failedUnits
  };
}

// Download the snapshot as pretty-printed JSON, named after the moment it was
// taken ("servermonitor-2026-10-29-14-03-07.json").
export function downloadSnapshot(data: DashboardData, at: number): void {
  const blob = new Blob([JSON.stringify(buildSnapshot(data, at), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `servermonitor-${formatTimestamp(at).replace(/[: ]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
