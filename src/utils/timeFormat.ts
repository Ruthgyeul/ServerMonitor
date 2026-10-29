// Time formatting for the console UI. All take explicit epoch milliseconds so
// they stay pure (and hydration-safe) — callers pass `now` from useNow().

const pad2 = (value: number): string => String(value).padStart(2, '0');

// "2026-10-29 14:03:07" in the viewer's local time.
export function formatTimestamp(at: number): string {
  const d = new Date(at);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

// "14:03" in the viewer's local time.
export function formatHourMinute(at: number): string {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// "10-29 14:03" in the viewer's local time.
export function formatShortStamp(at: number): string {
  return formatTimestamp(at).slice(5, 16);
}

// Compact age for lists: "now" under 45s, then "5m", "3h", "2d".
export function formatAge(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 45) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`;

// Spelled-out duration for prose: "12 seconds", "1 minute", "3 hours", "2 days".
export function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return plural(seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.floor(hours / 24), 'day');
}
