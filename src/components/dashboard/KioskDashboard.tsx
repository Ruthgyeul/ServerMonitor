import React from 'react';

import { TerminalTitleBar } from '@/components/common/TerminalWindow';
import { NetworkHistoryEntry } from '@/types/system';
import { DashboardData } from '@/utils/dashboardData';

import { AlertBar, Header } from './Dashboard';
import {
  BandwidthCard,
  BandwidthHistoryCard,
  CoresCard,
  FanCard,
  GaugeRow,
  InterfacesCard,
  LoadCard,
  NetworkCard,
  NetworkStripCard,
  TemperatureCard,
  UptimeCard
} from './cards';

// Purpose-built kiosk view for /monitor — a no-interaction 7" (1024x600)
// panel physically attached to the server. Unlike the main dashboard (`/`,
// still the full 17-card Dashboard.tsx), this shows only the 11 cards the
// kiosk needs: uptime, load avg, cores, fan+temp, the ping/error/connection
// strip, the CPU/GPU/RAM/disk gauges, the network activity chart,
// interfaces+bandwidth, and monthly bandwidth history. Alerts/processes/ssh/
// traffic/firewall — all list-shaped or interactive cards — are dropped
// entirely, so this uses its own .kiosk-layout/.kiosk-col CSS (2 columns)
// rather than the main dashboard's 3-column .dash-layout/.dash-col, which
// stays untouched for `/`. NetworkStripCard sits in the left column (not
// alongside the other network cards) purely to balance column height within
// the 600px kiosk budget — confirmed against a real 1024x600 render.

interface KioskDashboardProps {
  data: DashboardData;
  connected: boolean;
  lastUpdate: number | null;
  now: number | null;
  networkHistory: NetworkHistoryEntry[];
}

export const KioskDashboard: React.FC<KioskDashboardProps> = ({
  data,
  connected,
  lastUpdate,
  now,
  networkHistory
}) => (
  <div className="terminal-bg min-h-screen text-gray-100">
    <TerminalTitleBar host={data.host.hostname || 'server'} />
    <Header data={data} connected={connected} lastUpdate={lastUpdate} now={now} />
    <AlertBar data={data} />

    <div className="kiosk-layout">
      <div className="kiosk-col">
        <UptimeCard data={data} />
        <LoadCard data={data} />
        <CoresCard data={data} />
        <div className="dash-subgrid">
          <FanCard data={data} />
          <TemperatureCard data={data} />
        </div>
        <NetworkStripCard data={data} />
      </div>

      <div className="kiosk-col">
        <GaugeRow data={data} />
        <NetworkCard data={data} history={networkHistory} />
        <div className="dash-subgrid">
          <InterfacesCard data={data} />
          <BandwidthCard data={data} />
        </div>
        <BandwidthHistoryCard />
      </div>
    </div>
  </div>
);
