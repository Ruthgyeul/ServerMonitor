import React from 'react';

import { BrandLine } from '@/components/common/TerminalWindow';

// Shown before the first response from /api/system. After receiving one, the
// caller keeps showing the last value even if the connection drops, and
// signals status via the header indicator instead of this screen.
export const StartupState: React.FC<{ error: string | null }> = ({ error }) => (
  <div className="flex flex-col items-center justify-center gap-3 p-8 font-mono">
    <BrandLine />
    {error ? (
      <>
        <div className="text-sm font-bold text-red-400">Cannot reach /api/system</div>
        <div className="max-w-[600px] text-center text-xs text-gray-400">{error}</div>
      </>
    ) : (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <span className="h-1.5 w-1.5 animate-[pulseDot_1s_ease-in-out_infinite] rounded-full bg-[#38bdf8]" />
        Connecting to /api/system…
      </div>
    )}
  </div>
);
