'use client';

import React from 'react';
import Link from 'next/link';
import { Boxes } from 'lucide-react';

import { ControlButton } from '@/components/control/ControlButton';
import { permissionFor, sendControl, unitUrl, useControlStatus } from '@/components/control/controlApi';
import { useShellActions } from '@/components/shell/ShellActions';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { Tag } from '@/components/ui/Tag';
import type { ServicesInfo } from '@/types/system';

// systemd health: failed units first and prominent.
export function ServicesPanel({ services }: { services: ServicesInfo }) {
  const { openLogs } = useShellActions();
  const control = useControlStatus();
  const failed = services.failed;
  return (
    <Panel
      className="flex flex-[1_1_320px] flex-col"
      title="Services"
      headerClassName="gap-x-2.5"
      actions={
        <>
          {failed === null ? (
            <Tag tone="neutral">unknown</Tag>
          ) : (
            <Tag tone={failed > 0 ? 'crit' : 'ok'}>{failed} failed</Tag>
          )}
          <Link href="/services" className="text-xs">
            All units
          </Link>
        </>
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
              <button
                onClick={() => openLogs({ kind: 'unit', name: unit, title: `journalctl -u ${unit}` })}
                className="text-xs text-fg-3 hover:text-fg"
              >
                Logs
              </button>
              <ControlButton
                label="Restart"
                permission={permissionFor(control, 'unit', unit)}
                run={() => sendControl(unitUrl(unit), { action: 'restart' })}
                className="border-0 px-0 py-0 text-xs text-link hover:bg-transparent"
              />
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
