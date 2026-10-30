import fs from 'fs';
import path from 'path';

import { AlertLevel } from '@/types/system';
import { processSingleton } from '@/utils/processSingleton';

// Which notification channels are on and which alert levels they carry, set
// from the Notifications page. Browser push is per device (the browser keeps
// its own opt-in); this store holds the server-side switch for the webhook
// and the level filter both channels honour. Defaults follow the design:
// webhook on, critical and warning sent, info and recoveries kept quiet. One store per
// process (globalThis) so routes and the collection loop agree.

export interface NotificationSettings {
  webhook: boolean;
  levels: Record<AlertLevel, boolean>;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  webhook: true,
  levels: { critical: true, warning: true, info: false, ok: false }
};

const LEVELS: AlertLevel[] = ['critical', 'warning', 'info', 'ok'];

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.NOTIFICATIONS_FILE || path.join(DATA_DIR, 'notifications.json');
const STORE_VERSION = 1;

// Pure: merge a partial update (from the API) over current settings, ignoring
// anything that isn't a boolean in a known slot.
export function mergeSettings(current: NotificationSettings, patch: unknown): NotificationSettings {
  const next: NotificationSettings = { webhook: current.webhook, levels: { ...current.levels } };
  if (!patch || typeof patch !== 'object') return next;
  const body = patch as Record<string, unknown>;
  if (typeof body.webhook === 'boolean') next.webhook = body.webhook;
  if (body.levels && typeof body.levels === 'object') {
    const levels = body.levels as Record<string, unknown>;
    for (const level of LEVELS) {
      if (typeof levels[level] === 'boolean') next.levels[level] = levels[level] as boolean;
    }
  }
  return next;
}

class SettingsStore {
  private settings: NotificationSettings = DEFAULT_SETTINGS;

  constructor() {
    try {
      const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')) as {
        v: number;
        settings: unknown;
      };
      if (parsed?.v === STORE_VERSION) this.settings = mergeSettings(DEFAULT_SETTINGS, parsed.settings);
    } catch {
      // first run: defaults
    }
  }

  get(): NotificationSettings {
    return { webhook: this.settings.webhook, levels: { ...this.settings.levels } };
  }

  update(patch: unknown): NotificationSettings {
    this.settings = mergeSettings(this.settings, patch);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        `${STORE_FILE}.tmp`,
        JSON.stringify({ v: STORE_VERSION, settings: this.settings }),
        'utf-8'
      );
      fs.renameSync(`${STORE_FILE}.tmp`, STORE_FILE);
    } catch {
      // Applies in memory for this process; the next change retries the save.
    }
    return this.get();
  }

  // Should an alert of this level go out on the webhook?
  webhookAllows(level: AlertLevel): boolean {
    return this.settings.webhook && this.settings.levels[level];
  }
}

export function notificationSettings(): SettingsStore {
  return processSingleton('notificationSettings', () => new SettingsStore());
}
