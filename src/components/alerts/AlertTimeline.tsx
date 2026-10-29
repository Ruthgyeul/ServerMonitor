import React from 'react';

import { LEVEL_STYLES } from '@/lib/statusColors';
import type { AlertEntry } from '@/types/system';
import { formatTimestamp } from '@/utils/timeFormat';

// Every alert of the last 48 hours as a tick on one strip, oldest at the left.

const WINDOW_MS = 48 * 60 * 60 * 1000;

export function AlertTimeline({ alerts, now }: { alerts: AlertEntry[]; now: number }) {
  const ticks = alerts.flatMap(alert => {
    const at = new Date(alert.at).getTime();
    const age = now - at;
    if (age < 0 || age > WINDOW_MS) return [];
    return [{ alert, fraction: 1 - age / WINDOW_MS, at }];
  });

  return (
    <section className="rounded-[10px] border border-line bg-card px-[18px] py-3.5">
      <div className="mb-2 flex justify-between text-[11.5px] text-subtle">
        <span>Incident timeline · 48h</span>
        <span className="font-mono">now</span>
      </div>
      <div className="relative h-7 rounded-md bg-sidebar">
        {ticks.map(({ alert, fraction, at }) => (
          <span
            key={alert.id}
            title={`${formatTimestamp(at)} — ${alert.message}`}
            className="absolute top-[7px] h-3.5 w-1 rounded-[2px]"
            style={{
              left: `calc(${(fraction * 100).toFixed(2)}% - 4px)`,
              background: LEVEL_STYLES[alert.level].dot
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-faint">
        {['-48h', '-36h', '-24h', '-12h', 'now'].map(label => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}
