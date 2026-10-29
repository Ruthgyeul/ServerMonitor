import React from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { LevelTag } from '@/components/ui/LevelTag';
import type { AlertEntry } from '@/types/system';
import { formatAge } from '@/utils/timeFormat';

const RECENT = 6;

// The latest alert-log entries (any level), newest first.
export function AlertLogPanel({ alerts, now }: { alerts: AlertEntry[]; now: number }) {
  const recent = alerts.slice(0, RECENT);
  return (
    <Panel
      className="flex flex-[1_1_320px] flex-col"
      title="Alert log"
      actions={
        <Link href="/alerts" className="text-xs">
          View all
        </Link>
      }
    >
      {recent.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No alerts yet"
          body="Alerts and system events will show up here as they happen."
        />
      ) : (
        <ul className="flex flex-col">
          {recent.map(alert => {
            return (
              <li
                key={alert.id}
                className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 border-b border-line-soft px-[18px] py-[11px]"
              >
                <LevelTag level={alert.level} />
                <span className="min-w-0 text-[12.5px] leading-[1.4] text-fg-2">{alert.message}</span>
                <span className="font-mono text-[11px] whitespace-nowrap text-faint">
                  {formatAge(now - new Date(alert.at).getTime())}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
