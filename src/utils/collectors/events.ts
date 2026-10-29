import fs from 'fs';
import path from 'path';

import { DockerContainer, HostEvent, HostEventKind } from '@/types/system';

// Host events drawn as markers on the overview's time charts: reboots, container
// (re)deploys and restarts. Derived by comparing each sample with the previous
// one, so nothing extra is collected. The last snapshot is persisted with the
// events, which keeps an app restart from re-announcing state that hasn't
// changed (and lets a reboot be noticed across the restart it caused).

const MAX_EVENTS = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Boot times read from /proc can wobble by a second or two between samples.
const BOOT_TOLERANCE_MS = 60_000;

export interface ContainerState {
  id: string;
  state: string;
  image: string;
}

export interface HostSnapshot {
  bootTime: string | null;
  containers: Record<string, ContainerState>;
}

export interface EventDraft {
  kind: HostEventKind;
  label: string;
  at: number;
}

export function snapshotOf(
  bootTime: string | null,
  containers: Pick<DockerContainer, 'id' | 'name' | 'state' | 'image'>[]
): HostSnapshot {
  return {
    bootTime,
    containers: Object.fromEntries(
      containers.map(({ name, id, state, image }) => [name, { id, state, image }])
    )
  };
}

// Pure: the events implied by moving from `prev` to `next`. A null `prev`
// (first run ever) reports only the current boot, so the chart shows when the
// host last came up.
export function detectEvents(
  prev: HostSnapshot | null,
  next: HostSnapshot,
  at: number,
  rebootReason: string | null = null
): EventDraft[] {
  const events: EventDraft[] = [];
  const reason = rebootReason ?? 'reason unknown';

  if (next.bootTime) {
    const bootAt = new Date(next.bootTime).getTime();
    const prevBoot = prev?.bootTime ? new Date(prev.bootTime).getTime() : null;
    if (prevBoot === null || Math.abs(bootAt - prevBoot) > BOOT_TOLERANCE_MS) {
      events.push({ kind: 'reboot', label: `Host rebooted · ${reason}`, at: bootAt });
    }
  }

  // Without a previous container roster there is nothing to compare against.
  const before = prev?.containers;
  if (!before || Object.keys(before).length === 0) return events;

  for (const [name, now] of Object.entries(next.containers)) {
    if (now.state !== 'running') continue;
    const was = before[name];
    if (!was) {
      events.push({ kind: 'deploy', label: `${name} created (${now.image})`, at });
    } else if (was.id !== now.id) {
      const image = was.image !== now.image ? ` (${now.image})` : '';
      events.push({ kind: 'deploy', label: `${name} redeployed${image}`, at });
    } else if (was.state !== 'running') {
      events.push({
        kind: 'restart',
        label: `${name} ${was.state === 'restarting' ? 'restarted' : 'started'}`,
        at
      });
    }
  }
  return events;
}

// --- Store ---------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.EVENTS_FILE || path.join(DATA_DIR, 'events.json');
const STORE_VERSION = 1;

interface StoreShape {
  v: number;
  snapshot: HostSnapshot | null;
  events: HostEvent[];
}

let loaded = false;
let snapshot: HostSnapshot | null = null;
const events: HostEvent[] = []; // oldest first
let sequence = 0;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')) as StoreShape;
    if (parsed?.v === STORE_VERSION) {
      snapshot = parsed.snapshot ?? null;
      if (Array.isArray(parsed.events)) events.push(...parsed.events.slice(-MAX_EVENTS));
    }
  } catch {
    // Missing or unreadable — start empty.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const payload: StoreShape = { v: STORE_VERSION, snapshot, events };
    void fs.promises
      .mkdir(DATA_DIR, { recursive: true })
      .then(() => fs.promises.writeFile(`${STORE_FILE}.tmp`, JSON.stringify(payload), 'utf-8'))
      .then(() => fs.promises.rename(`${STORE_FILE}.tmp`, STORE_FILE))
      .catch(() => {
        /* not fatal — retried on the next change */
      });
  }, 2000);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

// Called once per collection tick. Docker data is optional: a host without
// Docker passes an empty roster and only reboots are tracked.
export function recordHostState(
  bootTime: string | null,
  rebootReason: string | null,
  containers: Pick<DockerContainer, 'id' | 'name' | 'state' | 'image'>[],
  at: number = Date.now()
): void {
  ensureLoaded();
  const next = snapshotOf(bootTime, containers);
  const drafts = detectEvents(snapshot, next, at, rebootReason);
  const changed = JSON.stringify(next) !== JSON.stringify(snapshot);
  snapshot = next;

  for (const draft of drafts) {
    // Another module instance (the boot-time collection loop vs. route
    // handlers) may have recorded the same transition from the same store.
    const iso = new Date(draft.at).toISOString();
    if (events.some(event => event.kind === draft.kind && event.at === iso && event.label === draft.label))
      continue;
    sequence += 1;
    events.push({
      id: `${at}-${sequence}`,
      kind: draft.kind,
      label: draft.label,
      at: iso
    });
  }
  if (drafts.length > 0) {
    events.sort((a, b) => a.at.localeCompare(b.at));
    const oldest = at - RETENTION_MS;
    while (events.length > 0 && (events.length > MAX_EVENTS || new Date(events[0].at).getTime() < oldest)) {
      events.shift();
    }
  }
  if (changed || drafts.length > 0) scheduleSave();
}

// Events newer than `sinceMs` ago, oldest first.
export function getHostEvents(sinceMs: number, now: number = Date.now()): HostEvent[] {
  ensureLoaded();
  const oldest = now - sinceMs;
  return events.filter(event => new Date(event.at).getTime() >= oldest);
}
