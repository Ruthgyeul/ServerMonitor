'use client';

import { useEffect, useRef, useState } from 'react';

import type { AlertEntry } from '@/types/system';

// Desktop notification + audible beep when a NEW critical alert appears, so an
// unattended wall panel can still get someone's attention. Opt-in: nothing fires
// until the viewer enables it (which also requests Notification permission). The
// enabled flag is remembered per-browser in localStorage.

const STORAGE_KEY = 'sm-alert-notify';

function beep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch {
    // WebAudio unavailable — silently skip the sound.
  }
}

export interface AlertNotifications {
  enabled: boolean;
  toggle: () => void;
}

export function useAlertNotifications(alerts: AlertEntry[]): AlertNotifications {
  // Restore the saved preference lazily. Safe against hydration: this only drives
  // the corner toggle icon, which isn't in the initial SSR HTML (the page shows
  // the startup state until data loads).
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const seenId = useRef<string | null>(null);

  // Seed the "last seen" marker to the newest alert so enabling doesn't replay
  // history; only alerts newer than this fire.
  useEffect(() => {
    if (seenId.current === null && alerts.length > 0) seenId.current = alerts[0].id;
  }, [alerts]);

  useEffect(() => {
    if (!enabled || alerts.length === 0) return;
    const newest = alerts[0];
    if (newest.id === seenId.current) return;

    // Fire for any new critical alert that arrived since we last looked.
    const previousMarker = seenId.current;
    seenId.current = newest.id;
    const fresh: AlertEntry[] = [];
    for (const alert of alerts) {
      if (alert.id === previousMarker) break;
      fresh.push(alert);
    }
    const critical = fresh.find(alert => alert.level === 'critical');
    if (!critical) return;

    beep();
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Server Monitor', { body: critical.message });
      }
    } catch {
      /* notifications unavailable */
    }
  }, [enabled, alerts]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (next && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  };

  return { enabled, toggle };
}
