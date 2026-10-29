'use client';

import React from 'react';
import { WifiOff } from 'lucide-react';

import { formatDuration, formatTimestamp } from '@/utils/timeFormat';

// Shown under the header while the stream is down but a previous sample exists:
// the page keeps rendering that frozen sample, and this says so.
export function OfflineBanner({
  lastUpdate,
  now,
  onRetry
}: {
  lastUpdate: number;
  now: number;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-crit/25 bg-crit/7 px-4 py-2.5 desk:px-7">
      <WifiOff size={15} className="shrink-0 text-crit" />
      <span className="text-[13px] font-medium text-crit-fg">Connection to the server lost</span>
      <span className="text-[12.5px] text-fg-3">
        Showing the last data received at{' '}
        <span className="font-mono">{formatTimestamp(lastUpdate).slice(11)}</span> (
        {formatDuration(now - lastUpdate)} ago). Values are frozen until the stream reconnects.
      </span>
      <button
        onClick={onRetry}
        className="ml-auto rounded-md bg-white/8 px-3 py-[5px] text-xs text-fg hover:bg-white/12"
      >
        Retry now
      </button>
    </div>
  );
}
