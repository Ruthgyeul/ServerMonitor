import React from 'react';

import { StatusCard } from '@/components/status/StatusCard';

// Public status page: no login, no sidebar, only sanitised metrics.
export default function StatusPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <StatusCard />
    </main>
  );
}
