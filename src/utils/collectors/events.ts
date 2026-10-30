import fs from 'fs';
import path from 'path';

import { DockerContainer, HostEvent, HostEventKind } from '@/types/system';
import { runArgs } from '@/utils/collectors/shell';
import { processSingleton } from '@/utils/processSingleton';

// Host events drawn as markers on the overview's time charts: reboots (with
// the reason, e.g. a kernel update), deploys (this app's version, container
// (re)deploys) and restarts (containers, systemd units, dashboard control
// actions). Derived by comparing each sample with the previous one, so nothing
// extra is collected. The last snapshot is persisted with the events, which
// keeps an app restart from re-announcing state that hasn't changed (and lets a
// reboot be noticed across the restart it caused).

const MAX_EVENTS = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Boot times read from /proc can wobble by a second or two between samples.
const BOOT_TOLERANCE_MS = 60_000;

export interface ContainerState {
  id: string;
  state: string;
  image: string;
  status?: string;
}

export interface UnitState {
  since: string | null;
  restarts: number | null;
}

export interface HostSnapshot {
  bootTime: string | null;
  kernel?: string | null;
  containers: Record<string, ContainerState>;
}

// A transition worth recording. `exit` (a container that stopped) goes to the
// alert history rather than the chart markers.
export interface EventDraft {
  kind: HostEventKind | 'exit';
  label: string;
  at: number;
}

export function snapshotOf(
  bootTime: string | null,
  containers: (Pick<DockerContainer, 'id' | 'name' | 'state' | 'image'> &
    Partial<Pick<DockerContainer, 'status'>>)[],
  kernel: string | null = null
): HostSnapshot {
  return {
    bootTime,
    kernel,
    containers: Object.fromEntries(
      containers.map(({ name, id, state, image, status }) => [name, { id, state, image, status }])
    )
  };
}

// Pure: the exit code in Docker's status text ("Exited (137) 2 seconds ago").
export function exitCodeOf(status: string | undefined): number | null {
  const match = status?.match(/Exited \((\d+)\)/);
  return match ? Number(match[1]) : null;
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

  if (next.bootTime) {
    const bootAt = new Date(next.bootTime).getTime();
    const prevBoot = prev?.bootTime ? new Date(prev.bootTime).getTime() : null;
    if (prevBoot === null || Math.abs(bootAt - prevBoot) > BOOT_TOLERANCE_MS) {
      const kernelChanged = Boolean(prev?.kernel && next.kernel && prev.kernel !== next.kernel);
      const reason = kernelChanged ? 'kernel update' : (rebootReason ?? 'reason unknown');
      events.push({ kind: 'reboot', label: `Host rebooted · ${reason}`, at: bootAt });
    }
  }

  // Without a previous container roster there is nothing to compare against.
  const before = prev?.containers;
  if (!before || Object.keys(before).length === 0) return events;

  for (const [name, now] of Object.entries(next.containers)) {
    const was = before[name];
    if (now.state !== 'running') {
      if (was?.state === 'running' && was.id === now.id && now.state === 'exited') {
        const code = exitCodeOf(now.status);
        events.push({
          kind: 'exit',
          label: `Container ${name} exited${code === null ? '' : ` (${code})`}`,
          at
        });
      }
      continue;
    }
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

// Pure: systemd units that restarted between two snapshots — a unit that was
// already up whose start time moved or whose restart counter went up.
export function detectUnitRestarts(
  prev: Record<string, UnitState> | null,
  next: Record<string, UnitState>,
  at: number
): EventDraft[] {
  if (!prev) return [];
  const events: EventDraft[] = [];
  for (const [name, now] of Object.entries(next)) {
    const was = prev[name];
    if (!was || !now.since || !was.since) continue;
    const restarted = (now.restarts ?? 0) > (was.restarts ?? 0);
    if (now.since !== was.since || restarted) {
      events.push({ kind: 'restart', label: `${name} restarted`, at: new Date(now.since).getTime() || at });
    }
  }
  return events;
}

// Pure: `last -x -F reboot` → boot times and kernels, oldest first.
// Lines look like "reboot   system boot  6.8.0-45-generic Thu Oct 23 17:06:12 2026 - …".
export function parseLastReboots(output: string): { at: number; kernel: string }[] {
  const boots: { at: number; kernel: string }[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(
      /^reboot\s+system boot\s+(\S+)\s+\w{3} (\w{3})\s+(\d{1,2}) (\d{2}:\d{2}:\d{2}) (\d{4})/
    );
    if (!match) continue;
    const [, kernel, month, day, time, year] = match;
    const at = Date.parse(`${month} ${day} ${year} ${time}`);
    if (Number.isFinite(at)) boots.push({ at, kernel });
  }
  return boots.sort((a, b) => a.at - b.at);
}

// Pure: past reboots as events, labelled "kernel update" when the kernel
// differs from the boot before. The current boot is left to detectEvents.
export function rebootHistory(
  boots: { at: number; kernel: string }[],
  currentBoot: number | null
): EventDraft[] {
  return boots.flatMap((boot, index) => {
    if (currentBoot !== null && Math.abs(boot.at - currentBoot) <= BOOT_TOLERANCE_MS) return [];
    const previous = boots[index - 1];
    const reason = previous && previous.kernel !== boot.kernel ? 'kernel update' : 'reason unknown';
    return [{ kind: 'reboot' as const, label: `Host rebooted · ${reason}`, at: boot.at }];
  });
}

// --- Store ---------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.EVENTS_FILE || path.join(DATA_DIR, 'events.json');
const STORE_VERSION = 1;

interface StoreShape {
  v: number;
  snapshot: HostSnapshot | null;
  units?: Record<string, UnitState> | null;
  appVersion?: string | null;
  events: HostEvent[];
}

// Shared by every bundle in the process (see processSingleton), so control
// actions in a route and the collection loop write one event list.
const state = processSingleton('events', () => ({
  loaded: false,
  snapshot: null as HostSnapshot | null,
  units: null as Record<string, UnitState> | null,
  appVersion: null as string | null,
  events: [] as HostEvent[], // oldest first
  sequence: 0,
  saveTimer: null as ReturnType<typeof setTimeout> | null,
  backfillStarted: false
}));

function ensureLoaded(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')) as StoreShape;
    if (parsed?.v === STORE_VERSION) {
      state.snapshot = parsed.snapshot ?? null;
      state.units = parsed.units ?? null;
      state.appVersion = parsed.appVersion ?? null;
      if (Array.isArray(parsed.events)) state.events.push(...parsed.events.slice(-MAX_EVENTS));
    }
  } catch {
    // Missing or unreadable — start empty.
  }
}

function scheduleSave(): void {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    const payload: StoreShape = {
      v: STORE_VERSION,
      snapshot: state.snapshot,
      units: state.units,
      appVersion: state.appVersion,
      events: state.events
    };
    void fs.promises
      .mkdir(DATA_DIR, { recursive: true })
      .then(() => fs.promises.writeFile(`${STORE_FILE}.tmp`, JSON.stringify(payload), 'utf-8'))
      .then(() => fs.promises.rename(`${STORE_FILE}.tmp`, STORE_FILE))
      .catch(() => {
        /* not fatal — retried on the next change */
      });
  }, 2000);
  if (typeof state.saveTimer.unref === 'function') state.saveTimer.unref();
}

// Add chart events (skipping exact duplicates), keep them ordered and within
// retention. Returns how many were new.
function addEvents(drafts: EventDraft[], now: number): number {
  let added = 0;
  for (const draft of drafts) {
    if (draft.kind === 'exit') continue;
    const iso = new Date(draft.at).toISOString();
    if (
      state.events.some(event => event.kind === draft.kind && event.at === iso && event.label === draft.label)
    ) {
      continue;
    }
    state.sequence += 1;
    state.events.push({ id: `${now}-${state.sequence}`, kind: draft.kind, label: draft.label, at: iso });
    added += 1;
  }
  if (added > 0) {
    state.events.sort((a, b) => a.at.localeCompare(b.at));
    const oldest = now - RETENTION_MS;
    while (
      state.events.length > 0 &&
      (state.events.length > MAX_EVENTS || new Date(state.events[0].at).getTime() < oldest)
    ) {
      state.events.shift();
    }
  }
  return added;
}

// On the very first run, fill in the reboots `last` still remembers.
function backfillReboots(currentBoot: number | null): void {
  if (state.backfillStarted) return;
  state.backfillStarted = true;
  void runArgs('last', ['-x', '-F', 'reboot'])
    .then(output => {
      const now = Date.now();
      const drafts = rebootHistory(parseLastReboots(output), currentBoot).filter(
        draft => draft.at >= now - RETENTION_MS
      );
      if (addEvents(drafts, now) > 0) scheduleSave();
    })
    .catch(() => {
      // `last` missing or wtmp unreadable: only reboots seen from now on.
    });
}

// Called once per collection tick. Docker data is optional: a host without
// Docker passes an empty roster and only reboots are tracked. Returns the
// containers that stopped since the last tick, for the alert history.
export function recordHostState(
  bootTime: string | null,
  rebootReason: string | null,
  containers: Pick<DockerContainer, 'id' | 'name' | 'state' | 'image' | 'status'>[],
  at: number = Date.now(),
  kernel: string | null = null
): string[] {
  ensureLoaded();
  const prev = state.snapshot;
  const next = snapshotOf(bootTime, containers, kernel);
  if (prev === null) backfillReboots(bootTime ? new Date(bootTime).getTime() : null);
  const drafts = detectEvents(prev, next, at, rebootReason);
  const changed = JSON.stringify(next) !== JSON.stringify(prev);
  state.snapshot = next;
  const added = addEvents(drafts, at);
  if (changed || added > 0) scheduleSave();
  return drafts.filter(draft => draft.kind === 'exit').map(draft => draft.label);
}

// systemd units' start times and restart counters, from the services list.
export function recordUnitStates(units: Record<string, UnitState>, at: number = Date.now()): void {
  ensureLoaded();
  const drafts = detectUnitRestarts(state.units, units, at);
  const changed = JSON.stringify(units) !== JSON.stringify(state.units);
  state.units = units;
  if (addEvents(drafts, at) > 0 || changed) scheduleSave();
}

// This app's version: a change since the last run is a deploy.
export function recordAppVersion(version: string, at: number = Date.now()): void {
  ensureLoaded();
  if (state.appVersion === version) return;
  state.appVersion = version;
  addEvents([{ kind: 'deploy', label: `servermonitor v${version}`, at }], at);
  scheduleSave();
}

// Anything else worth a marker, e.g. a restart run from the dashboard.
export function recordEvent(kind: HostEventKind, label: string, at: number = Date.now()): void {
  ensureLoaded();
  if (addEvents([{ kind, label, at }], at) > 0) scheduleSave();
}

// Events newer than `sinceMs` ago, oldest first.
export function getHostEvents(sinceMs: number, now: number = Date.now()): HostEvent[] {
  ensureLoaded();
  const oldest = now - sinceMs;
  return state.events.filter(event => new Date(event.at).getTime() >= oldest);
}
