import React from 'react';
import { WifiOff } from 'lucide-react';

// The stream failed before any sample arrived, so there is no frozen data to
// fall back on. EventSource keeps retrying in the background.
export function ConnectError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-crit/10">
          <WifiOff size={18} className="text-crit" />
        </span>
        <span className="text-sm font-medium">{message}</span>
        <span className="text-[12.5px] text-muted">
          Retrying automatically. Check that the server is running and reachable from this device.
        </span>
        <button
          onClick={onRetry}
          className="mt-1 rounded-md bg-white/8 px-3 py-[5px] text-xs text-fg hover:bg-white/12"
        >
          Retry now
        </button>
      </div>
    </div>
  );
}
