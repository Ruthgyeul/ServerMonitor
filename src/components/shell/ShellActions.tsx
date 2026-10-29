'use client';

import { createContext, useContext } from 'react';

import type { LogSource } from '@/components/logs/LogDrawer';

// Shell-owned UI a page can trigger: the Customize dialog (also behind the
// header button) and the log drawer.
export interface ShellActions {
  openCustomize: () => void;
  // Open the log drawer for a unit or container.
  openLogs: (source: LogSource) => void;
}

export const ShellActionsContext = createContext<ShellActions>({
  openCustomize: () => {},
  openLogs: () => {}
});

export function useShellActions(): ShellActions {
  return useContext(ShellActionsContext);
}
