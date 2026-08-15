// Estimates "at this rate, when does it fill?" from the recent trend of root
// disk usage. Unlike the history buckets (load/cpu) this is a live estimate,
// so it is not persisted to disk — the window refills after a restart. That is
// enough for a forecast.

export interface DiskSample {
  at: number;
  percent: number;
}

// Derive a linear growth rate from the first/last sample in the window and
// return the hours left until 100%. If it isn't rising enough to fill
// (shrinking/flat) return null — don't invent a number when "filling soon"
// isn't true.
export function predictHoursToFull(samples: DiskSample[], at: number): number | null {
  if (samples.length < 2) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const spanHours = (last.at - first.at) / 3_600_000;
  if (spanHours <= 0) return null;

  const ratePerHour = (last.percent - first.percent) / spanHours;
  // Treat growth below 0.1%p/hour as noise and don't forecast (a pointless far future).
  if (ratePerHour < 0.1) return null;

  const remaining = 100 - last.percent;
  if (remaining <= 0) return 0;

  void at;
  return Math.round((remaining / ratePerHour) * 10) / 10;
}

const WINDOW_MS = 6 * 60 * 60 * 1000; // only the last 6 hours of trend
const samples: DiskSample[] = [];

export function recordDiskSample(percent: number, at: number = Date.now()): void {
  samples.push({ at, percent });
  const oldest = at - WINDOW_MS;
  let drop = 0;
  while (drop < samples.length && samples[drop].at < oldest) drop += 1;
  if (drop > 0) samples.splice(0, drop);
}

export function getHoursToFull(at: number = Date.now()): number | null {
  return predictHoursToFull(samples, at);
}
