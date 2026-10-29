'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';

import { areaPath, linePath, niceMax, padToWindow } from '@/components/charts/paths';
import type { ClusterNode } from '@/components/cluster/clusterTypes';
import { useCluster } from '@/components/cluster/useCluster';
import { UPTIME_BADGE_URL, type UptimeList } from '@/components/uptime/uptimeApi';
import { summarize } from '@/components/uptime/uptimeView';
import { usePolled } from '@/hooks/usePolled';
import { usageColor } from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { NetworkHistoryEntry } from '@/types/system';
import type { DashboardData } from '@/utils/dashboardData';
import { formatTimestamp } from '@/utils/timeFormat';

// Wall display: a fixed 1280×720 stage scaled to fit the screen, alternating
// between this host and the cluster. Big type, no hover, touch-sized controls.

const STAGE_W = 1280;
const STAGE_H = 720;
const EVERY_OPTIONS = [10, 30, 60, 0] as const;
const CLUSTER_POLL_MS = 2000;
// A stage-wide temperature scale: 90°C fills the tile bar.
const TEMP_SCALE = 90;
// Seconds of throughput the network chart spans (the stream keeps 60 samples).
const NETWORK_WINDOW = 60;

type View = 'host' | 'cluster';

const other = (view: View): View => (view === 'host' ? 'cluster' : 'host');

interface KioskScreenProps {
  data: DashboardData;
  networkHistory: NetworkHistoryEntry[];
  now: number;
  initialEvery: number;
  onExit: () => void;
}

function subscribeResize(notify: () => void): () => void {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
}

// Scale that fits the stage inside the window.
function useStageScale(): number {
  return useSyncExternalStore(
    subscribeResize,
    () => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H),
    () => 1
  );
}

export function KioskScreen({ data, networkHistory, now, initialEvery, onExit }: KioskScreenProps) {
  const scale = useStageScale();
  // The rotation is derived from the clock: `base` is the view shown at
  // `since`, and every `every` seconds after that the view flips.
  const [base, setBase] = useState<View>('host');
  const [every, setEvery] = useState(initialEvery);
  const [since, setSince] = useState(now);
  const cluster = useCluster(CLUSTER_POLL_MS);

  const elapsed = Math.max(0, (now - since) / 1000);
  const cycles = every ? Math.floor(elapsed / every) : 0;
  const view: View = cycles % 2 === 0 ? base : other(base);
  const intoCycle = every ? elapsed - cycles * every : 0;
  const left = every ? Math.max(0, Math.ceil(every - intoCycle)) : 0;

  const restart = (nextBase: View) => {
    setBase(nextBase);
    setSince(now);
  };
  const switchView = () => restart(other(view));

  const nodes = cluster.nodes ?? [];
  const online = nodes.filter(node => node.result.ok).length;
  const active = data.activeAlerts;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center overflow-hidden bg-black">
      <div
        className="box-border flex shrink-0 flex-col overflow-hidden bg-canvas"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: 'center' }}
      >
        <div className="box-border flex h-16 shrink-0 items-center gap-5 border-b border-line px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={cn('h-3 w-3 animate-live rounded-full', active.length ? 'bg-crit' : 'bg-ok')} />
            <span className="text-2xl font-semibold tracking-[-0.02em] whitespace-nowrap">
              {view === 'host' ? data.host.hostname : 'Cluster'}
            </span>
            <span className="text-[15px] whitespace-nowrap text-muted">
              {view === 'host'
                ? active.length
                  ? `${active.length} active alert${active.length > 1 ? 's' : ''}`
                  : 'All systems normal'
                : `${online} of ${nodes.length} nodes online`}
            </span>
          </div>
          <div className="flex w-[170px] flex-col gap-1.5">
            <span className="text-[13px] whitespace-nowrap text-muted">
              {every ? `${view === 'host' ? 'Cluster' : 'Host'} in ${left}s` : 'Rotation off'}
            </span>
            <div className="h-1 overflow-hidden rounded-sm bg-track">
              <div
                className="h-full bg-accent"
                style={{ width: every ? `${Math.min(100, (intoCycle / every) * 100)}%` : 0 }}
              />
            </div>
          </div>
          <div className="flex rounded-[9px] border border-line bg-[#12151c] p-[3px]">
            {EVERY_OPTIONS.map(option => (
              <button
                key={option}
                onClick={() => {
                  setEvery(option);
                  restart(view);
                }}
                className={cn(
                  'h-[38px] min-w-12 rounded-[7px] px-2.5 font-mono text-sm',
                  every === option ? 'bg-active text-fg' : 'text-subtle'
                )}
              >
                {option ? `${option}s` : 'Off'}
              </button>
            ))}
          </div>
          <button
            onClick={switchView}
            className="h-11 rounded-[9px] border border-white/10 px-4 text-[15px] text-fg-2 active:bg-white/8"
          >
            Switch
          </button>
          <span className="min-w-[136px] text-right font-mono text-[30px] text-fg">
            {formatTimestamp(now).slice(11)}
          </span>
          <button
            onClick={onExit}
            aria-label="Exit kiosk"
            className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/10 text-fg-2 active:bg-white/8"
          >
            <X size={20} />
          </button>
        </div>

        {active.length > 0 && (
          <div className="box-border flex h-11 shrink-0 items-center gap-5 overflow-hidden border-b border-crit/35 bg-crit/14 px-5 whitespace-nowrap">
            <span className="text-lg font-semibold text-crit-fg">
              {active.length} active alert{active.length > 1 ? 's' : ''}
            </span>
            {active.map(alert => (
              <span key={alert.key} className="font-mono text-base text-fg">
                {alert.message}
              </span>
            ))}
          </div>
        )}

        {view === 'host' ? (
          <HostView data={data} networkHistory={networkHistory} />
        ) : (
          <ClusterView nodes={nodes} loading={cluster.nodes === null} />
        )}
      </div>
    </div>
  );
}

// The HTTP-check count only needs a coarse refresh on the wall screen.
const UPTIME_POLL_MS = 15_000;

function HostView({ data, networkHistory }: { data: DashboardData; networkHistory: NetworkHistoryEntry[] }) {
  const firing = (key: string) => data.activeAlerts.some(alert => alert.key === key);
  const temp = data.cpu.temperature === 'N/A' ? null : data.cpu.temperature;
  const tiles = [
    { label: 'CPU', value: data.cpu.usage, unit: '%', pct: data.cpu.usage, key: 'cpu' },
    { label: 'Memory', value: data.memory.percentage, unit: '%', pct: data.memory.percentage, key: 'memory' },
    { label: 'Disk', value: data.disk.percentage, unit: '%', pct: data.disk.percentage, key: 'disk' },
    {
      label: 'CPU temp',
      value: temp,
      unit: '°C',
      pct: temp === null ? 0 : (temp / TEMP_SCALE) * 100,
      key: 'temperature'
    }
  ];
  const down = padToWindow(
    networkHistory.map(point => point.download),
    NETWORK_WINDOW
  );
  const up = padToWindow(
    networkHistory.map(point => point.upload),
    NETWORK_WINDOW
  );
  const max = niceMax(Math.max(0, ...networkHistory.map(point => Math.max(point.download, point.upload))));
  const box = { x: 0, y: 5, width: 760, height: 210 };
  const { days, hours, minutes } = data.uptime;
  const failed = data.services.failed ?? 0;
  const checks = usePolled<UptimeList>(UPTIME_BADGE_URL, UPTIME_POLL_MS)?.checks ?? [];
  const http = summarize(checks);
  const strip = [
    { label: 'Uptime', value: `${days}d ${hours}h ${minutes}m`, alarm: false },
    { label: 'Load 1m', value: data.load.avg1.toFixed(2), alarm: false },
    {
      label: 'Ping',
      value: data.network.ping > 0 ? `${data.network.ping.toFixed(0)} ms` : '—',
      alarm: false
    },
    {
      label: 'Containers',
      value: data.docker.available ? `${data.docker.running}/${data.docker.total}` : '—',
      alarm: false
    },
    { label: 'Failed units', value: String(failed), alarm: failed > 0 },
    {
      label: 'HTTP checks',
      value: http.live > 0 ? `${http.up}/${http.live}` : '—',
      alarm: http.up < http.live
    }
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-3.5 pb-4">
      <div className="grid shrink-0 grid-cols-4 gap-3">
        {tiles.map(tile => {
          const alert = firing(tile.key);
          const color = alert ? PALETTE.crit : usageColor(tile.pct, PALETTE.ok);
          const state = alert ? 'alert' : tile.pct >= 70 ? 'high' : 'normal';
          return (
            <div
              key={tile.label}
              className={cn(
                'flex flex-col gap-2.5 rounded-xl border bg-card px-[18px] py-3.5',
                alert ? 'border-crit/40' : 'border-line'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[17px] text-muted">{tile.label}</span>
                <span className="text-[13px]" style={{ color }}>
                  {tile.value === null ? 'no sensor' : state}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[52px] leading-none font-medium tracking-[-0.04em]">
                  {tile.value === null ? '—' : tile.value.toFixed(1)}
                </span>
                <span className="font-mono text-xl text-subtle">{tile.unit}</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-track">
                <div className="h-full" style={{ width: `${Math.min(100, tile.pct)}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-line bg-card px-[18px] pt-3 pb-2.5">
        <div className="flex items-center gap-7">
          <span className="flex-1 text-[17px] text-muted">Network</span>
          <span className="font-mono text-xl text-accent">↓ {data.network.download.toFixed(1)} KB/s</span>
          <span className="font-mono text-xl text-upload">↑ {data.network.upload.toFixed(1)} KB/s</span>
        </div>
        <svg viewBox="0 0 760 220" preserveAspectRatio="none" className="block min-h-0 w-full flex-1">
          <defs>
            <linearGradient id="kiosk-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={PALETTE.upload} stopOpacity="0.22" />
              <stop offset="1" stopColor={PALETTE.upload} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath(up, box, max)} fill="url(#kiosk-up)" />
          <path
            d={linePath(up, box, max)}
            fill="none"
            stroke={PALETTE.upload}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={linePath(down, box, max)}
            fill="none"
            stroke={PALETTE.accent}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="grid shrink-0 grid-cols-6 gap-3">
        {strip.map(item => (
          <div
            key={item.label}
            className="flex flex-col gap-1 rounded-xl border border-line bg-card px-4 py-2.5"
          >
            <span className="text-sm text-muted">{item.label}</span>
            <span className={cn('font-mono text-2xl', item.alarm ? 'text-crit-fg' : 'text-fg')}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClusterView({ nodes, loading }: { nodes: ClusterNode[]; loading: boolean }) {
  if (nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xl text-muted">
        {loading ? 'Loading cluster…' : 'No cluster nodes configured'}
      </div>
    );
  }
  return (
    <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-3 px-5 pt-3.5 pb-4">
      {nodes.map(node => {
        const { result } = node;
        return (
          <div
            key={node.name}
            className={cn(
              'flex min-h-0 flex-col justify-center gap-3.5 rounded-xl border bg-card px-5 py-4',
              result.ok ? 'border-line' : 'border-crit/25'
            )}
          >
            <div className="flex items-center gap-3">
              <span className={cn('h-3 w-3 rounded-full', result.ok ? 'bg-ok' : 'bg-crit')} />
              <span className="flex-1 text-[22px] font-semibold">{node.name}</span>
              {result.ok && (
                <span className="font-mono text-[15px] text-muted">
                  {result.data.cpu.temperature === 'N/A'
                    ? 'N/A'
                    : `${result.data.cpu.temperature.toFixed(1)}°C`}{' '}
                  · {result.data.network.ping > 0 ? `${result.data.network.ping.toFixed(0)} ms` : '—'}
                </span>
              )}
            </div>
            {!result.ok ? (
              <>
                <span className="text-lg text-crit-fg">Offline</span>
                <span className="font-mono text-[15px] text-muted">{result.error}</span>
              </>
            ) : (
              (
                [
                  ['CPU', result.data.cpu.usage],
                  ['RAM', result.data.memory.percentage],
                  ['DISK', result.data.disk.percentage]
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[60px_1fr_64px] items-center gap-3.5 font-mono">
                  <span className="text-[15px] text-muted">{label}</span>
                  <div className="h-3 overflow-hidden rounded-md bg-track">
                    <div
                      className="h-full"
                      style={{ width: `${Math.min(100, value)}%`, background: usageColor(value) }}
                    />
                  </div>
                  <span className="text-right text-[22px]">{value.toFixed(0)}%</span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
