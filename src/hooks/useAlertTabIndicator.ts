'use client';

import { useEffect } from 'react';

// So an alert is visible from the tab alone: while something is breached,
// prefix the document title with ⚠ and swap the favicon for a red dot. Useful
// when several tabs are left open on a wall.

const MARK = '⚠ ';
const ALERT_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#ef5f5a"/></svg>'
  );

export function useAlertTabIndicator(alerting: boolean): void {
  useEffect(() => {
    const base = document.title.startsWith(MARK) ? document.title.slice(MARK.length) : document.title;
    document.title = alerting ? MARK + base : base;

    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    // Remember the original icon and restore it when the alert clears.
    const original = icon.dataset.original ?? icon.getAttribute('href') ?? '/favicon.svg';
    icon.dataset.original = original;
    icon.setAttribute('href', alerting ? ALERT_FAVICON : original);
  }, [alerting]);
}
