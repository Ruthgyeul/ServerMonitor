// Display-only formatters for the dashboard. Collectors always send the same
// unit (KB/s for network, GB for disk), and all human-readable unit conversion happens here.

export function formatRate(kbPerSecond: number): string {
  if (!Number.isFinite(kbPerSecond)) return '0 KB/s';
  if (kbPerSecond >= 1024) return `${(kbPerSecond / 1024).toFixed(2)} MB/s`;
  return `${kbPerSecond.toFixed(kbPerSecond >= 10 ? 0 : 1)} KB/s`;
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

// A kernel release like "5.15.0-101-generic" is long. Keep only the version in the header.
export function shortKernel(release: string): string {
  return release.split('-')[0];
}

// Formats a network link/port speed given in Mbit/s, auto-scaling across the
// full range a link can negotiate: a sub-1 Mbps WAN/ISP link shows as bps or
// kbps, a typical NIC as Mbps, and a multi-gigabit one as Gbps. The input may
// be fractional — a 500 kbps link is 0.5 Mbps, a 10 bps link is 0.00001 Mbps.
export function formatNetSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return '0bps';
  // Trim trailing zeros so 10 shows as "10", not "10.00", while 2.5 is kept.
  const trim = (value: number) => Number(value.toFixed(2)).toString();
  if (mbps >= 1000) return `${trim(mbps / 1000)}Gbps`;
  if (mbps >= 1) return `${trim(mbps)}Mbps`;
  if (mbps >= 0.001) return `${trim(mbps * 1000)}kbps`;
  return `${trim(mbps * 1_000_000)}bps`;
}

export function formatLinkSpeed(mbps: number | null): string {
  if (mbps === null) return 'unknown link speed';
  return `${formatNetSpeed(mbps)} link`;
}
