import type { DockerContainerDetail } from '@/types/system';
import { formatDuration } from '@/utils/timeFormat';

// Byte sizes as the Docker page shows them: "412 MB", "1.84 GB".
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${bytes} B`;
}

const timeOf = (iso: string | null | undefined): number | null => {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};

// Status in `docker ps` words, from the inspect times so it stays current
// between polls: "Up 9 hours", "Up 2 days (Paused)", "Exited (0) 6 hours ago".
// Falls back to the status text docker printed when the times are missing.
export function containerStatus(
  container: Pick<DockerContainerDetail, 'state' | 'status' | 'startedAt' | 'finishedAt' | 'exitCode'>,
  now: number
): string {
  const started = timeOf(container.startedAt);
  const finished = timeOf(container.finishedAt);
  switch (container.state) {
    case 'running':
      return started === null ? container.status : `Up ${formatDuration(now - started)}`;
    case 'paused':
      return started === null ? container.status : `Up ${formatDuration(now - started)} (Paused)`;
    case 'restarting':
      return 'Restarting…';
    case 'exited':
    case 'dead':
      return finished === null || container.exitCode === null || container.exitCode === undefined
        ? container.status
        : `Exited (${container.exitCode}) ${formatDuration(now - finished)} ago`;
    default:
      return container.status || container.state;
  }
}
