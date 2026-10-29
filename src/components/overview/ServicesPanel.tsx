import React from 'react';
import { Boxes } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { Tag } from '@/components/ui/Tag';
import type { ServicesInfo } from '@/types/system';

// systemd health: failed units first and prominent.
export function ServicesPanel({ services }: { services: ServicesInfo }) {
  const failed = services.failed;
  return (
    <Panel
      className="flex flex-[1_1_320px] flex-col"
      title="Services"
      headerClassName="gap-x-2.5"
      actions={
        failed === null ? (
          <Tag tone="neutral">unknown</Tag>
        ) : (
          <Tag tone={failed > 0 ? 'crit' : 'ok'}>{failed} failed</Tag>
        )
      }
    >
      {failed === null ? (
        <EmptyState
          icon={Boxes}
          title="systemd not available"
          body="Unit state can't be read on this host."
        />
      ) : failed === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No failed units"
          body="Every systemd service is running or exited cleanly."
        />
      ) : (
        <>
          {services.failedUnits.map(unit => (
            <div
              key={unit}
              className="flex items-center gap-2.5 border-b border-line-soft bg-crit/6 px-[18px] py-2.5"
            >
              <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-crit" />
              <span className="flex-1 truncate font-mono text-xs text-crit-fg">{unit}</span>
            </div>
          ))}
          {failed > services.failedUnits.length && (
            <p className="px-[18px] py-2.5 text-xs text-subtle">
              +{failed - services.failedUnits.length} more
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
