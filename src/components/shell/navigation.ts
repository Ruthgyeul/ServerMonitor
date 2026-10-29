import {
  Boxes,
  Container,
  GitCompare,
  Globe,
  LayoutDashboard,
  ServerCog,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react';

// Console routes: sidebar entries plus the header breadcrumb/title for each page.
// Pages land here as their phase ships; the order follows the design.

export type NavBadgeKey = 'alerts' | 'cluster' | 'docker' | 'services';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Live count source rendered as a pill next to the label.
  badge?: NavBadgeKey;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Monitor',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard },
      { href: '/compare', label: 'Compare', icon: GitCompare },
      { href: '/cluster', label: 'Cluster', icon: ServerCog, badge: 'cluster' },
      { href: '/docker', label: 'Docker', icon: Container, badge: 'docker' },
      { href: '/services', label: 'Services', icon: Boxes, badge: 'services' },
      { href: '/alerts', label: 'Alerts', icon: TriangleAlert, badge: 'alerts' },
      { href: '/status-preview', label: 'Status page', icon: Globe }
    ]
  },
  {
    title: 'Configure',
    items: [{ href: '/settings/rules', label: 'Alert rules', icon: SlidersHorizontal }]
  }
];

export interface PageMeta {
  // Breadcrumb section and item, then the page heading.
  section: string;
  item: string;
  title: string;
}

// `host` fills the overview crumb ("Hosts / <hostname>").
export function pageMeta(pathname: string, host: string): PageMeta {
  switch (pathname) {
    case '/cluster':
      return { section: 'Monitor', item: 'Cluster', title: 'Cluster' };
    case '/alerts':
      return { section: 'Monitor', item: 'Alerts', title: 'Alert history' };
    case '/compare':
      return { section: 'Monitor', item: 'Compare', title: 'Metric comparison' };
    case '/docker':
      return { section: host, item: 'Docker', title: 'Docker' };
    case '/services':
      return { section: host, item: 'Services', title: 'systemd services' };
    case '/status-preview':
      return { section: 'Monitor', item: 'Status page', title: 'Public status' };
    case '/settings/rules':
      return { section: 'Configure', item: 'Alert rules', title: 'Alert rules' };
    default:
      return { section: 'Hosts', item: host, title: 'Overview' };
  }
}

// Exact match: "/settings" style parents must not light up on child pages.
export function isActive(pathname: string, href: string): boolean {
  return pathname === href;
}
