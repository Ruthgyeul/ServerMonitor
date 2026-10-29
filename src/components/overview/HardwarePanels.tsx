import React from 'react';

import { linePath, padToWindow } from '@/components/charts/paths';
import { Panel } from '@/components/ui/Panel';
import { Tag } from '@/components/ui/Tag';
import type { DiskIoPoint } from '@/hooks/useSystemData';
import { usageColor } from '@/lib/statusColors';
import { PALETTE } from '@/lib/theme';
import type { DashboardData } from '@/utils/dashboardData';
import { formatAge } from '@/utils/timeFormat';
import { formatLinkSpeed, formatMbPair, formatNetSpeed } from '@/utils/format';

// The bottom row of the overview: hardware sensors, interfaces, security.

// Temperature bar scale: 90°C fills it.
const TEMP_SCALE = 90;
// Disk I/O samples the stream keeps (one per second).
const IO_WINDOW = 60;

const row = 'flex justify-between border-b border-line-soft px-[18px] py-[11px] text-[12.5px]';

export function HardwarePanel({ data, diskIo }: { data: DashboardData; diskIo: DiskIoPoint[] }) {
  const { cpu, gpu, fan, swap, diskIO, thresholds } = data;
  const enter = thresholds.ALERT_TEMP_ENTER ?? 74;
  const clear = thresholds.ALERT_TEMP_CLEAR ?? 70;
  const temp = cpu.temperature === 'N/A' ? null : cpu.temperature;
  const io = formatMbPair(diskIO.read, diskIO.write);
  const ioMax = Math.max(0.001, ...diskIo.map(point => Math.max(point.read, point.write)));
  const ioBox = { x: 0, y: 1, width: 200, height: 28 };
  const pct = (value: number) => `${Math.min(100, (value / TEMP_SCALE) * 100)}%`;

  return (
    <Panel title="Hardware">
      <dl className="flex flex-col">
        <div className="flex flex-col gap-2 border-b border-line-soft px-[18px] py-3">
          <div className="flex justify-between text-[12.5px]">
            <dt className="text-muted">CPU temperature</dt>
            <dd className="font-mono">{temp === null ? 'no sensor' : `${temp.toFixed(1)}°C`}</dd>
          </div>
          {temp !== null && (
            <>
              <div className="relative h-1 rounded-sm bg-track">
                <div
                  className="h-full rounded-sm"
                  style={{ width: pct(temp), background: usageColor((temp / enter) * 85, PALETTE.ok) }}
                />
                <div
                  title="clear threshold"
                  className="absolute -top-0.5 h-2 w-px bg-warn"
                  style={{ left: pct(clear) }}
                />
                <div
                  title="alert threshold"
                  className="absolute -top-0.5 h-2 w-px bg-crit"
                  style={{ left: pct(enter) }}
                />
              </div>
              <span className="text-[11.5px] text-subtle">
                {temp > enter
                  ? `${(temp - enter).toFixed(1)}° above alert threshold (${enter}°C)`
                  : `${(enter - temp).toFixed(1)}° below alert threshold (${enter}°C)`}
              </span>
            </>
          )}
        </div>
        <div className={row}>
          <dt className="text-muted">GPU</dt>
          <dd className="font-mono text-subtle">
            {gpu.name === null
              ? 'no sensor'
              : `${gpu.usage === 'N/A' ? '—' : `${gpu.usage.toFixed(0)}%`} · ${gpu.temperature === 'N/A' ? '—' : `${gpu.temperature.toFixed(0)}°C`}`}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted">Fan</dt>
          <dd className="font-mono text-subtle">{fan.cpu > 0 ? `${fan.cpu} RPM` : 'N/A'}</dd>
        </div>
        <div className={row}>
          <dt className="text-muted">Swap</dt>
          <dd className="font-mono">
            {swap.total > 0 ? (
              `${swap.used.toFixed(2)} / ${swap.total.toFixed(1)} GB`
            ) : (
              <span className="text-subtle">off</span>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-2 px-[18px] py-3">
          <div className="flex justify-between text-[12.5px]">
            <dt className="text-muted">Disk I/O</dt>
            <dd className="font-mono text-xs">
              <span className="text-accent">R {io.read}</span>{' '}
              <span className="text-upload">W {io.write}</span> <span className="text-subtle">{io.unit}</span>
            </dd>
          </div>
          <svg viewBox="0 0 200 30" preserveAspectRatio="none" className="block h-[34px] w-full">
            <path
              d={linePath(
                padToWindow(
                  diskIo.map(point => point.write),
                  IO_WINDOW
                ),
                ioBox,
                ioMax
              )}
              fill="none"
              stroke={PALETTE.upload}
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={linePath(
                padToWindow(
                  diskIo.map(point => point.read),
                  IO_WINDOW
                ),
                ioBox,
                ioMax
              )}
              fill="none"
              stroke={PALETTE.accent}
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </dl>
    </Panel>
  );
}

export function InterfacesPanel({ data }: { data: DashboardData }) {
  const { interfaces, linkSpeedMbps, bandwidthPercentage } = data.network;
  return (
    <Panel
      title="Interfaces"
      actions={
        <span className="font-mono text-[11px] text-subtle">
          {linkSpeedMbps === null
            ? 'link speed unknown'
            : `link ${bandwidthPercentage.toFixed(1)}% of ${formatLinkSpeed(linkSpeedMbps)}`}
        </span>
      }
    >
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3.5 gap-y-1 px-[18px] pt-2.5 pb-1.5 text-[11px] text-faint">
        <span>Interface</span>
        <span>Address</span>
        <span className="text-right">Link</span>
      </div>
      {interfaces.length === 0 ? (
        <p className="border-t border-line-soft px-[18px] py-3 text-xs text-subtle">
          No interfaces reported.
        </p>
      ) : (
        interfaces.map(iface => (
          <div
            key={iface.name}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3.5 border-t border-line-soft px-[18px] py-[9px] font-mono text-xs"
          >
            <span className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    iface.state === 'up' ? PALETTE.ok : iface.state === 'down' ? PALETTE.crit : PALETTE.faint
                }}
              />
              {iface.name}
              {iface.isDefault && <span className="text-[10.5px] text-subtle">default</span>}
            </span>
            <span className="text-muted">{iface.ip ?? '—'}</span>
            <span className="min-w-16 text-right">
              {iface.state !== 'up'
                ? iface.state
                : iface.speedMbps === null
                  ? 'up'
                  : formatNetSpeed(iface.speedMbps)}
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}

const MAX_LIST = 4;

export function SecurityPanel({ data, now }: { data: DashboardData; now: number }) {
  const { firewall, sshSessions, topTraffic, portScanSuspects = [] } = data.security;
  const fwTone = firewall.status === 'active' ? 'ok' : firewall.status === 'inactive' ? 'crit' : 'neutral';
  const fwDot =
    firewall.status === 'active' ? PALETTE.ok : firewall.status === 'inactive' ? PALETTE.crit : PALETTE.faint;
  const label = 'px-[18px] pt-2.5 pb-1 text-[11px] text-faint';
  const item = 'flex justify-between px-[18px] py-[7px] font-mono text-xs';

  return (
    <Panel
      title="Security"
      headerClassName="gap-x-2.5"
      actions={
        <Tag tone={fwTone} className="flex items-center gap-1.5">
          <span className="h-[5px] w-[5px] rounded-full" style={{ background: fwDot }} />
          {firewall.backend ?? 'firewall'} {firewall.status}
        </Tag>
      }
    >
      <div className="grid grid-cols-2 border-b border-white/5">
        <div className="flex flex-col gap-[3px] border-r border-white/5 px-[18px] py-3">
          <span className="text-[11.5px] text-subtle">Blocked · 24h</span>
          <span className="font-mono text-lg font-medium">{firewall.blockedAttempts ?? '—'}</span>
        </div>
        <div className="flex flex-col gap-[3px] px-[18px] py-3">
          <span className="text-[11.5px] text-subtle">SSH sessions</span>
          <span className="font-mono text-lg font-medium">{sshSessions.length}</span>
        </div>
      </div>
      {portScanSuspects.length > 0 && (
        <>
          <div className={label}>Possible port scans</div>
          {portScanSuspects.slice(0, MAX_LIST).map(suspect => (
            <div key={suspect.ip} className={`${item} bg-warn/6`}>
              <span className="text-warn-fg">{suspect.ip}</span>
              <span className="text-muted">{suspect.distinctPorts} ports</span>
            </div>
          ))}
        </>
      )}
      <div className={label}>Active sessions</div>
      {sshSessions.length === 0 ? (
        <div className={`${item} text-subtle`}>no remote sessions</div>
      ) : (
        sshSessions.slice(0, MAX_LIST).map(session => (
          <div key={`${session.user}@${session.ip}`} className={item}>
            <span className="text-fg-2">
              {session.user}@{session.ip}
            </span>
            <span className="text-faint">{formatAge(now - new Date(session.since).getTime())}</span>
          </div>
        ))
      )}
      <div className={`${label} border-t border-line-soft`}>Top traffic peers</div>
      {topTraffic.length === 0 ? (
        <div className={`${item} pb-2.5 text-subtle`}>no peers</div>
      ) : (
        topTraffic.slice(0, MAX_LIST).map(peer => (
          <div key={peer.ip} className={item}>
            <span className="text-fg-2">{peer.ip}</span>
            <span className="text-muted">
              {peer.connections} conn{peer.connections === 1 ? '' : 's'}
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}
