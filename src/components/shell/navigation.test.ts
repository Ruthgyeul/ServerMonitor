import { describe, expect, it } from 'vitest';

import { NAV_GROUPS, isActive, pageMeta } from '@/components/shell/navigation';

describe('pageMeta', () => {
  it('uses the hostname as the overview crumb', () => {
    expect(pageMeta('/', 'RuthSubServer')).toEqual({
      section: 'Hosts',
      item: 'RuthSubServer',
      title: 'Overview'
    });
  });

  it('describes every console page in the sidebar except the public status page', () => {
    const hrefs = NAV_GROUPS.flatMap(group => group.items.map(item => item.href)).filter(
      href => href !== '/' && href !== '/status'
    );
    for (const href of hrefs) expect(pageMeta(href, 'h').title).not.toBe('Overview');
  });
});

describe('isActive', () => {
  it('matches exactly so parent routes do not highlight on child pages', () => {
    expect(isActive('/alerts', '/alerts')).toBe(true);
    expect(isActive('/alerts/settings', '/alerts')).toBe(false);
    expect(isActive('/', '/')).toBe(true);
  });
});
