'use client';

import { useEffect } from 'react';
import { LayoutGrid } from 'lucide-react';

import { AlertLogPanel } from '@/components/overview/AlertLogPanel';
import { BandwidthPanel } from '@/components/overview/BandwidthPanel';
import { CapacityPanel } from '@/components/overview/CapacityPanel';
import { CpuLoadPanel } from '@/components/overview/CpuLoadPanel';
import { DockerPanel } from '@/components/overview/DockerPanel';
import { HardwarePanel, InterfacesPanel, SecurityPanel } from '@/components/overview/HardwarePanels';
import { KpiCards } from '@/components/overview/KpiCards';
import { NetworkPanel } from '@/components/overview/NetworkPanel';
import { ProcessesPanel } from '@/components/overview/ProcessesPanel';
import { ServicesPanel } from '@/components/overview/ServicesPanel';
import { StatusBanner } from '@/components/overview/StatusBanner';
import { hiddenSummary } from '@/components/overview/panels';
import { usePanelPrefs } from '@/components/overview/usePanelPrefs';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { useShellActions } from '@/components/shell/ShellActions';
import { PageBody, PanelRow } from '@/components/ui/PageBody';
import { useKioskRotate } from '@/hooks/useKioskRotate';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import type { HostEvent } from '@/types/system';

// Overview: status banner, then the panels this browser chose to show, in the
// design's rows. The console shell renders the loading/unreachable states, so
// data is present by the time this renders content.

const EVENTS_URL = '/api/events?days=7';
const EVENTS_POLL_MS = 60_000;

export default function OverviewPage() {
  const { data, diskIoHistory } = useSystem();
  const now = useNow();
  const { prefs } = usePanelPrefs();
  const { openCustomize } = useShellActions();
  const events = usePolled<HostEvent[]>(EVENTS_URL, EVENTS_POLL_MS) ?? [];
  // Kiosk rotation: with ?rotate=<seconds> the panel cycles to /cluster and back.
  useKioskRotate('/cluster');

  useEffect(() => {
    // Keep a wall-mounted screen from locking while the overview is open.
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').catch(() => {
      /* denied (e.g. tab hidden) — the display just follows its own timeout */
    });
  }, []);

  if (!data || now === null) return null;

  return (
    <PageBody>
      <StatusBanner data={data} />

      {prefs.kpis && <KpiCards data={data} events={events} now={now} />}

      {(prefs.network || prefs.alertlog) && (
        <PanelRow>
          {prefs.network && <NetworkPanel data={data} events={events} now={now} />}
          {prefs.alertlog && <AlertLogPanel alerts={data.alerts} now={now} />}
        </PanelRow>
      )}

      {(prefs.docker || prefs.services) && (
        <PanelRow>
          {prefs.docker && <DockerPanel docker={data.docker} />}
          {prefs.services && <ServicesPanel services={data.services} />}
        </PanelRow>
      )}

      {(prefs.cpu || prefs.procs) && (
        <PanelRow>
          {prefs.cpu && <CpuLoadPanel data={data} />}
          {prefs.procs && <ProcessesPanel data={data} />}
        </PanelRow>
      )}

      {(prefs.bandwidth || prefs.capacity) && (
        <PanelRow>
          {prefs.bandwidth && <BandwidthPanel />}
          {prefs.capacity && <CapacityPanel data={data} now={now} />}
        </PanelRow>
      )}

      {(prefs.hardware || prefs.ifaces || prefs.security) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
          {prefs.hardware && <HardwarePanel data={data} diskIo={diskIoHistory} />}
          {prefs.ifaces && <InterfacesPanel data={data} />}
          {prefs.security && <SecurityPanel data={data} now={now} />}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 rounded-[10px] border border-dashed border-line-strong p-3.5 text-[12.5px] text-dim">
        <span>{hiddenSummary(prefs)}</span>
        <button onClick={openCustomize} className="flex items-center gap-1.5 text-[12.5px] text-link">
          <LayoutGrid size={13} className="shrink-0" />
          Customize overview
        </button>
      </div>
    </PageBody>
  );
}
