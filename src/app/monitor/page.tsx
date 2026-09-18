'use client';

import { useEffect } from 'react';

import { TerminalScreen } from '@/components/common/TerminalWindow';
import { KioskDashboard } from '@/components/dashboard/KioskDashboard';
import { StartupState } from '@/components/dashboard/StartupState';
import { useNow } from '@/hooks/useNow';
import { useSystemData } from '@/hooks/useSystemData';
import { useKioskRotate } from '@/hooks/useKioskRotate';

const HOME_PATH = '/monitor';

// Dedicated kiosk view for the 7" display wired directly to this machine.
// Point the kiosk browser (scripts/run.sh's KIOSK_URL) at this route through
// the loopback bypass port (KIOSK_BYPASS_ENABLED/KIOSK_BYPASS_PORT, see
// server.js + src/utils/apiAuth.ts) so it shows live data with no login.
//
// Renders KioskDashboard, a trimmed 11-card set (uptime/load/cores/fan/temp/
// gauges/network/interfaces/bandwidth/ping strip/monthly bandwidth) in its
// own 2-column layout — not the full 17-card Dashboard the authenticated `/`
// page uses. No DashboardControls (notification toggle/export) or tab
// title/favicon alert effects here — there's no visible tab and no one to
// click a toggle on an unattended kiosk screen. authRequired still redirects
// to /login as a fallback for when the bypass isn't configured or this page
// is reached through the network-facing port instead.
export default function MonitorPage() {
  const { data, error, connected, lastUpdate, networkHistory, authRequired } = useSystemData();
  const now = useNow();
  // Declares /monitor as the rotation's home so /cluster's own rotation sends
  // the cycle back here instead of the ordinary dashboard (`/`).
  useKioskRotate('/cluster', HOME_PATH);

  useEffect(() => {
    if (authRequired) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  }, [authRequired]);

  useEffect(() => {
    const wakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.log('Wake lock failed:', err);
      }
    };
    wakeLock();
  }, []);

  if (data === null) {
    return (
      <TerminalScreen>
        <StartupState error={error} />
      </TerminalScreen>
    );
  }

  return (
    <KioskDashboard
      data={data}
      connected={connected}
      lastUpdate={lastUpdate}
      now={now}
      networkHistory={networkHistory}
    />
  );
}
