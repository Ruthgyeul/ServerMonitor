import {
  Globe,
  LayoutDashboard,
  ServerCog,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react';

// Console routes: sidebar entries plus the header breadcrumb/title for each page.
// Pages land here as their phase ships; the order follows the design.

export type NavBadgeKey = 'alerts';

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
      { href: '/cluster', label: 'Cluster', icon: ServerCog },
      { href: '/alerts', label: 'Alerts', icon: TriangleAlert, badge: 'alerts' },
      { href: '/status', label: 'Status page', icon: Globe }
    ]
  },
  {
    title: 'Configure',
    items: [{ href: '/alerts/settings', label: 'Alert rules', icon: SlidersHorizontal }]
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
    case '/alerts/settings':
      return { section: 'Configure', item: 'Alert rules', title: 'Alert rules' };
    default:
      return { section: 'Hosts', item: host, title: 'Overview' };
  }
}

// Exact match: "/alerts" must not light up while on "/alerts/settings".
export function isActive(pathname: string, href: string): boolean {
  return pathname === href;
}
