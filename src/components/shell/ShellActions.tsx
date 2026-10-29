'use client';

import { createContext, useContext } from 'react';

import type { LogSource } from '@/components/logs/LogDrawer';
import type { AlertNotifications } from '@/hooks/useAlertNotifications';

// Shell-owned UI a page can trigger: the Customize dialog (also behind the
// header button), the log drawer and this browser's notification opt-in.
export interface ShellActions {
  openCustomize: () => void;
  // Open the log drawer for a unit or container.
  openLogs: (source: LogSource) => void;
  // This browser's desktop-notification opt-in (the Notifications page toggles it).
  browserNotify: AlertNotifications;
}

export const ShellActionsContext = createContext<ShellActions>({
  openCustomize: () => {},
  openLogs: () => {},
  browserNotify: { enabled: false, toggle: () => {} }
});

export function useShellActions(): ShellActions {
  return useContext(ShellActionsContext);
}
