import React from 'react';

import { SystemDataProvider } from '@/components/providers/SystemDataProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { ConsoleShell } from '@/components/shell/ConsoleShell';

// Every authenticated console page renders inside the sidebar + header shell and
// shares one live data stream. Public pages (/status, /login) and the kiosk
// display (/monitor) sit outside this group.
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SystemDataProvider>
      <ToastProvider>
        <ConsoleShell>{children}</ConsoleShell>
      </ToastProvider>
    </SystemDataProvider>
  );
}
