// Byte sizes as the Docker page shows them: "412 MB", "1.84 GB".
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${bytes} B`;
}
