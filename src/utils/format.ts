// Display-only formatters for the dashboard. Collectors always send the same
// unit (KB/s for network, GB for disk), and all human-readable unit conversion happens here.

export function formatRate(kbPerSecond: number): string {
  if (!Number.isFinite(kbPerSecond)) return '0 KB/s';
  if (kbPerSecond >= 1024) return `${(kbPerSecond / 1024).toFixed(2)} MB/s`;
  return `${kbPerSecond.toFixed(kbPerSecond >= 10 ? 0 : 1)} KB/s`;
}

// Used when the unit needs to be attached separately, like on an axis tick.
export function rateUnit(maxKbPerSecond: number): { unit: string; divisor: number } {
  return maxKbPerSecond >= 1024 ? { unit: 'MB/s', divisor: 1024 } : { unit: 'KB/s', divisor: 1 };
}

// Disk I/O arrives in MB/s. A near-idle server sits far below 1 MB/s, so
// rounding to MB/s keeps showing 0.0. If the larger of the two is under 1 MB/s,
// switch both to KB/s — one shared unit, but the real value shows.
export function formatMbPair(readMb: number, writeMb: number): { read: string; write: string; unit: string } {
  const useKb = Math.max(readMb, writeMb) < 1;
  if (useKb) {
    const kb = (mb: number) => (mb * 1024).toFixed(mb * 1024 >= 10 ? 0 : 1);
    return { read: kb(readMb), write: kb(writeMb), unit: 'KB/s' };
  }
  return { read: readMb.toFixed(1), write: writeMb.toFixed(1), unit: 'MB/s' };
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)}${units[index]}`;
}

export function formatRelativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

export function formatClock(date: Date): string {
  const day = date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return `${day} ${time}`;
}

// "07-20 14:32" — the year is dropped to fit a narrow card.
export function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A kernel release like "5.15.0-101-generic" is long. Keep only the version in the header.
export function shortKernel(release: string): string {
  return release.split('-')[0];
}

export function formatLinkSpeed(mbps: number | null): string {
  if (mbps === null) return 'unknown link speed';
  return mbps >= 1000 ? `${mbps / 1000}Gbps link` : `${mbps}Mbps link`;
}
