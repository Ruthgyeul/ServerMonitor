'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

// Short confirmation messages ("Snapshot downloaded"), bottom-right, one at a time.

const TOAST_MS = 2600;

type Flash = (message: string) => void;

const ToastContext = createContext<Flash | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback<Flash>(next => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return (
    <ToastContext.Provider value={flash}>
      {children}
      {message && (
        <div
          role="status"
          className="fixed right-6 bottom-6 z-50 flex items-center gap-2.5 rounded-lg border border-white/10 bg-toast px-4 py-[11px] text-[13px] shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
        >
          <Check size={14} className="shrink-0 text-ok" strokeWidth={2.5} />
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): Flash {
  const flash = useContext(ToastContext);
  if (!flash) throw new Error('useToast must be used inside <ToastProvider>');
  return flash;
}
