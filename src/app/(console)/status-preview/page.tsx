'use client';

import React from 'react';
import { Link as LinkIcon } from 'lucide-react';

import { useToast } from '@/components/providers/ToastProvider';
import { StatusCard } from '@/components/status/StatusCard';

// The public /status page as visitors see it, inside the console.
export default function StatusPreviewPage() {
  const flash = useToast();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/status`);
      flash('Status link copied');
    } catch {
      flash('Could not copy the link');
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 px-4 pt-7 pb-12 desk:px-7">
      <div className="flex w-full max-w-[680px] flex-wrap items-center gap-x-4 gap-y-2.5">
        <span className="flex-1 text-[12.5px] text-dim">
          Preview of the public page at <span className="font-mono text-fg-2">/status</span>. Only sanitised
          metrics are shown.
        </span>
        <button
          onClick={() => void copyLink()}
          className="flex h-[30px] items-center gap-[7px] rounded-[7px] border border-line-strong px-3 text-[12.5px] text-fg-3 hover:bg-white/5 hover:text-fg"
        >
          <LinkIcon size={13} />
          Copy link
        </button>
      </div>
      <StatusCard />
    </div>
  );
}
