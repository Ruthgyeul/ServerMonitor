'use client';

import { useEffect } from 'react';

import { Dashboard } from '@/components/dashboard/Dashboard';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { useKioskRotate } from '@/hooks/useKioskRotate';
import { useNow } from '@/hooks/useNow';

// Overview. The console shell renders the loading/unreachable states, so data is
// always present by the time this page mounts its content.
export default function OverviewPage() {
  const { data, networkHistory, diskIoHistory } = useSystem();
  const now = useNow();
  // Kiosk rotation: with ?rotate=<seconds> the panel cycles to /cluster and back.
  useKioskRotate('/cluster');

  useEffect(() => {
    // Keep a wall-mounted screen from locking while the overview is open.
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').catch(() => {
      /* denied (e.g. tab hidden) — the display just follows its own timeout */
    });
  }, []);

  if (!data) return null;

  return <Dashboard data={data} now={now} networkHistory={networkHistory} diskIoHistory={diskIoHistory} />;
}
