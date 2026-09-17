// Estimates "at this rate, when does memory fill?" from the recent trend of
// RAM usage — the same approach as diskTrend.ts, mirrored for memory. A live
// estimate only (not persisted): the window refills after a restart, which is
// enough for a forecast.

import { predictHoursToFull, DiskSample } from '@/utils/collectors/diskTrend';

const WINDOW_MS = 6 * 60 * 60 * 1000; // only the last 6 hours of trend
const samples: DiskSample[] = [];

export function recordMemSample(percent: number, at: number = Date.now()): void {
  samples.push({ at, percent });
  const oldest = at - WINDOW_MS;
  let drop = 0;
  while (drop < samples.length && samples[drop].at < oldest) drop += 1;
  if (drop > 0) samples.splice(0, drop);
}

export function getMemHoursToFull(at: number = Date.now()): number | null {
  return predictHoursToFull(samples, at);
}
