// Alert muting: a manual "snooze" plus scheduled quiet hours. When muted, the
// external webhook notification is suppressed — the on-screen alert log still
// records every event, so nothing is lost, it just doesn't page anyone.
//
// Manual mute is process-memory only (a self-hosted single instance); it is set
// via /api/alerts/mute. Quiet hours come from ALERT_QUIET_HOURS in the server's
// local timezone.

let globalMuteUntil = 0; // epoch ms; 0 = not muted
const keyMuteUntil = new Map<string, number>();

const QUIET_HOURS = process.env.ALERT_QUIET_HOURS || null;

export function muteAll(minutes: number, at: number = Date.now()): number {
  globalMuteUntil = at + Math.max(0, minutes) * 60_000;
  return globalMuteUntil;
}

export function muteKey(key: string, minutes: number, at: number = Date.now()): number {
  const until = at + Math.max(0, minutes) * 60_000;
  keyMuteUntil.set(key, until);
  return until;
}

export function clearMute(): void {
  globalMuteUntil = 0;
  keyMuteUntil.clear();
}

// Pure: is `date` inside the "HH:MM-HH:MM" window (local time)? Wraps past
// midnight when start > end. Exported for testing and for status.
export function inQuietHours(date: Date = new Date(), spec: string | null = QUIET_HOURS): boolean {
  if (!spec) return false;
  const match = spec.match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!match) return false;

  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (start === end) return false;

  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

// Whether a notification for `key` (null = a keyless event) should be muted now.
export function isMuted(key: string | null = null, at: number = Date.now()): boolean {
  if (globalMuteUntil > at) return true;
  if (inQuietHours(new Date(at))) return true;
  if (key) {
    const until = keyMuteUntil.get(key);
    if (until !== undefined && until > at) return true;
  }
  return false;
}

export function muteStatus(at: number = Date.now()) {
  return {
    globalMutedUntil: globalMuteUntil > at ? new Date(globalMuteUntil).toISOString() : null,
    mutedKeys: [...keyMuteUntil.entries()]
      .filter(([, until]) => until > at)
      .map(([key, until]) => ({ key, until: new Date(until).toISOString() })),
    quietHours: QUIET_HOURS,
    quietNow: inQuietHours(new Date(at))
  };
}
