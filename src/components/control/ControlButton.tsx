'use client';

import React, { useState } from 'react';

import { refreshPolled } from '@/hooks/usePolled';
import { useToast } from '@/components/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import type { Permission } from '@/components/control/controlApi';

// A button for one control action. Disabled (with the reason as its tooltip)
// unless the server allows it; destructive actions ask first. After running it
// flashes the result and refreshes the given polls.

export interface Confirmation {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
}

interface ControlButtonProps {
  label: string;
  permission: Permission;
  run: () => Promise<{ ok: boolean; message: string }>;
  confirm?: Confirmation;
  // Polls to refresh after the action (e.g. the page's list endpoint).
  refresh?: string[];
  tone?: 'default' | 'danger' | 'positive';
  className?: string;
  children?: React.ReactNode;
}

const TONE = {
  default: 'text-fg-2',
  danger: 'text-crit-fg',
  positive: 'text-ok-fg'
} as const;

export function ControlButton({
  label,
  permission,
  run,
  confirm,
  refresh = [],
  tone = 'default',
  className,
  children
}: ControlButtonProps) {
  const flash = useToast();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const execute = async () => {
    setAsking(false);
    setBusy(true);
    const result = await run();
    setBusy(false);
    flash(result.message);
    refresh.forEach(refreshPolled);
  };

  return (
    <>
      <button
        type="button"
        disabled={!permission.allowed || busy}
        title={permission.allowed ? undefined : (permission.reason ?? undefined)}
        onClick={() => (confirm ? setAsking(true) : void execute())}
        className={cn(
          'rounded-[5px] border border-line-strong px-[9px] py-1 text-[11.5px] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent',
          TONE[tone],
          className
        )}
      >
        {children ?? (busy ? `${label}…` : label)}
      </button>
      {asking && confirm && (
        <Modal title={confirm.title} onClose={() => setAsking(false)}>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="text-[13px] leading-normal text-pretty text-fg-3">{confirm.body}</div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAsking(false)}
                className="rounded-[7px] bg-white/6 px-3.5 py-[7px] text-[12.5px] text-fg-2 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => void execute()}
                className="rounded-[7px] bg-crit px-3.5 py-[7px] text-[12.5px] font-medium text-canvas"
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
