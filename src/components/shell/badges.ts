import type { ClusterNode } from '@/components/cluster/clusterTypes';
import { jobState } from '@/components/jobs/jobsView';
import type { NavBadgeKey } from '@/components/shell/navigation';
import { summarize } from '@/components/uptime/uptimeView';
import type { ScheduledJob, ServiceUnit, UptimeCheck } from '@/types/system';
import type { DashboardData } from '@/utils/dashboardData';

// What each sidebar badge says, from the live sample and the polled lists.

// The services badge and the overview's Services panel share one request loop;
// its own query string keeps the Services page's faster polling separate.
export const SERVICES_BRIEF_URL = '/api/services?for=brief';
export const SERVICES_BRIEF_POLL_MS = 60_000;

export interface Badge {
  text: string;
  alarm: boolean;
}

// Live counts behind the sidebar badges.
export interface BadgeSources {
  data: DashboardData | null;
  cluster: ClusterNode[] | null;
  uptime: UptimeCheck[] | null;
  jobs: ScheduledJob[] | null;
  units: ServiceUnit[] | null;
  now: number;
}

// Notifications are muted by hand (until a time) or by quiet hours.
export function isMuted(data: DashboardData | null, now: number): boolean {
  if (!data) return false;
  const until = data.mute.globalMutedUntil;
  return (until !== null && new Date(until).getTime() > now) || data.mute.quietNow;
}

export function badgeFor(
  key: NavBadgeKey | undefined,
  { data, cluster, uptime, jobs, units, now }: BadgeSources
): Badge | null {
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
      if (failed > 0) return { text: String(failed), alarm: true };
      if (!units || units.length === 0) return null;
      const active = units.filter(unit => unit.active === 'active').length;
      return { text: `${active}/${units.length}`, alarm: false };
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
    case 'rules': {
      const custom = data?.overrideCount ?? 0;
      return custom > 0 ? { text: `${custom} custom`, alarm: false } : null;
    }
    case 'notifications':
      return isMuted(data, now) ? { text: 'muted', alarm: false } : null;
    default:
      return null;
  }
}
