'use client';

import { createContext, useContext } from 'react';

// Shell-owned UI a page can trigger (the overview's footer opens the same
// Customize dialog as the header button).
export interface ShellActions {
  openCustomize: () => void;
}

export const ShellActionsContext = createContext<ShellActions>({ openCustomize: () => {} });

export function useShellActions(): ShellActions {
  return useContext(ShellActionsContext);
}
