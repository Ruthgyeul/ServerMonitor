'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Server } from 'lucide-react';

import type { ClusterNode } from '@/components/cluster/clusterTypes';
import { jobState } from '@/components/jobs/jobsView';
import { useSystem } from '@/components/providers/SystemDataProvider';
import { InstallPwa } from '@/components/shell/InstallPwa';
import { NAV_GROUPS, isActive, type NavBadgeKey, type NavItem } from '@/components/shell/navigation';
import { UPTIME_BADGE_URL, type UptimeList } from '@/components/uptime/uptimeApi';
import { summarize } from '@/components/uptime/uptimeView';
import { SITE_NAME } from '@/config/siteConfig';
import { usePolled } from '@/hooks/usePolled';
import { cn } from '@/lib/utils';
import type { JobList, ScheduledJob, UptimeCheck } from '@/types/system';
import type { DashboardData } from '@/utils/dashboardData';
import { shortKernel } from '@/utils/format';

interface Badge {
  text: string;
  alarm: boolean;
}

// Live counts behind the sidebar badges.
interface BadgeSources {
  data: DashboardData | null;
  cluster: ClusterNode[] | null;
  uptime: UptimeCheck[] | null;
  jobs: ScheduledJob[] | null;
}

function badgeFor(key: NavBadgeKey | undefined, { data, cluster, uptime, jobs }: BadgeSources): Badge | null {
  switch (key) {
    case 'alerts': {
      const count = data?.activeAlerts.length ?? 0;
      return count > 0 ? { text: String(count), alarm: true } : null;
    }
    case 'cluster': {
      if (!cluster || cluster.length === 0) return null;
      const online = cluster.filter(node => node.result.ok).length;
      return { text: `${online}/${cluster.length}`, alarm: online < cluster.length };
    }
    case 'docker':
      return data?.docker.available
        ? { text: `${data.docker.running}/${data.docker.total}`, alarm: false }
        : null;
    case 'services': {
      const failed = data?.services.failed ?? 0;
      return failed > 0 ? { text: String(failed), alarm: true } : null;
    }
    case 'jobs': {
      if (!jobs || jobs.length === 0) return null;
      const failing = jobs.filter(job => jobState(job) === 'failed').length;
      return failing > 0
        ? { text: String(failing), alarm: true }
        : { text: String(jobs.length), alarm: false };
    }
    case 'uptime': {
      if (!uptime || uptime.length === 0) return null;
      const { up, live } = summarize(uptime);
      return { text: `${up}/${uptime.length}`, alarm: up < live };
    }
    default:
      return null;
  }
}

// The cluster badge only needs a coarse refresh; the Cluster page polls fast.
const CLUSTER_BADGE_POLL_MS = 30_000;
const UPTIME_BADGE_POLL_MS = 15_000;
const JOBS_BADGE_URL = '/api/jobs?for=badge';
const JOBS_BADGE_POLL_MS = 60_000;

const NavLink: React.FC<{ item: NavItem; active: boolean; badge: Badge | null; onNavigate: () => void }> = ({
  item,
  active,
  badge,
  onNavigate
}) => {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] hover:bg-white/4 hover:text-fg',
        active ? 'bg-white/6 text-fg' : 'text-nav'
      )}
    >
      <Icon size={15} className="shrink-0" />
      <span className="flex-1">{item.label}</span>
      {badge && (
        <span
          className={cn(
            'rounded px-1.5 py-px font-mono text-[10.5px]',
            badge.alarm ? 'bg-crit/18 text-crit-fg' : 'bg-white/6 text-fg-3'
          )}
        >
          {badge.text}
        </span>
      )}
    </Link>
  );
};

async function signOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    // Full navigation on purpose: drop the live stream and all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { data, connected } = useSystem();
  const cluster =
    usePolled<{ nodes: ClusterNode[] }>('/api/cluster', CLUSTER_BADGE_POLL_MS, false)?.nodes ?? null;
  const uptime = usePolled<UptimeList>(UPTIME_BADGE_URL, UPTIME_BADGE_POLL_MS)?.checks ?? null;
  const jobs = usePolled<JobList>(JOBS_BADGE_URL, JOBS_BADGE_POLL_MS)?.jobs ?? null;

  const defaultIp = data?.network.interfaces.find(iface => iface.isDefault)?.ip ?? null;
  const healthy = data !== null && connected && data.activeAlerts.length === 0;

  return (
    <>
      {open && <div onClick={onClose} className="fixed inset-0 z-[59] bg-[rgba(5,6,9,0.6)] desk:hidden" />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-[60] box-border flex h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-sidebar transition-transform duration-200 ease-out',
          'desk:sticky desk:top-0 desk:z-auto desk:translate-x-0 desk:shadow-none',
          open ? 'translate-x-0 shadow-[0_0_40px_rgba(0,0,0,0.6)]' : '-translate-x-full'
        )}
      >
        <Link
          href="/"
          onClick={onClose}
          className="flex items-center gap-2.5 px-[18px] pt-[18px] pb-5 text-fg hover:text-fg"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-accent/35 bg-brand-tile">
            <Server size={15} className="text-accent" />
          </div>
          <div className="flex flex-col gap-px">
            <span className="text-sm font-semibold tracking-[-0.01em]">ServerMonitor</span>
            <span className="text-[11px] text-subtle">{SITE_NAME}</span>
          </div>
        </Link>

        <nav className="flex flex-col gap-0.5 px-2.5">
          {NAV_GROUPS.map((group, index) => (
            <React.Fragment key={group.title}>
              <span
                className={cn(
                  'px-2.5 pb-1.5 text-[10.5px] font-medium tracking-[0.06em] text-faint uppercase',
                  index === 0 ? 'pt-2' : 'pt-[18px]'
                )}
              >
                {group.title}
              </span>
              {group.items.map(item => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  badge={badgeFor(item.badge, { data, cluster, uptime, jobs })}
                  onNavigate={onClose}
                />
              ))}
            </React.Fragment>
          ))}
        </nav>

        <div className="mt-auto px-2.5 pt-4 pb-2.5">
          <InstallPwa />
        </div>

        <div className="border-t border-line p-3.5">
          <span className="text-[10.5px] font-medium tracking-[0.06em] text-faint">HOST</span>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', healthy ? 'bg-ok' : 'bg-crit')} />
            <span className="truncate text-[13px] font-medium">{data?.host.hostname ?? '—'}</span>
          </div>
          {data && (
            <div className="mt-1 font-mono text-[11px] leading-normal text-subtle">
              {defaultIp && (
                <>
                  {defaultIp}
                  <br />
                </>
              )}
              {data.host.os} · {shortKernel(data.host.kernel)}
            </div>
          )}
          {data?.loginEnabled && (
            <button
              onClick={() => void signOut()}
              className="mt-3 flex items-center gap-[7px] text-xs text-muted hover:text-fg"
            >
              <LogOut size={13} />
              Sign out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
