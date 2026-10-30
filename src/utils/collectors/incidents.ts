import fs from 'fs';
import path from 'path';

import { AlertLevel, AlertThreshold } from '@/types/system';
import { processSingleton } from '@/utils/processSingleton';

// Incidents: one per alert firing, opened when it fires and resolved when it
// recovers, with a timeline an operator can add to (acknowledge, notes, manual
// resolve/reopen). Persisted to data/incidents.json. A single store per process
// (kept on globalThis) so the collection loop that opens incidents and the API
// routes that act on them share the same records even when Next bundles them
// separately.

export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export type IncidentEventKind = 'trigger' | 'notify' | 'ack' | 'note' | 'resolve' | 'reopen';
export type IncidentAction = 'ack' | 'note' | 'resolve' | 'reopen';

export interface IncidentEvent {
  at: string; // ISO 8601
  kind: IncidentEventKind;
  text: string;
  // Who added it: the dashboard operator, or the system (fire, notify, auto-resolve).
  author?: 'operator' | 'system';
}

export interface Incident {
  id: string;
  key: string; // the alert key (cpu, http:<id>, job:<timer>, svc:<unit>, …)
  title: string;
  level: AlertLevel;
  rule: string | null;
  // The threshold in force when it fired (threshold rules only).
  threshold?: AlertThreshold | null;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt: string | null;
  events: IncidentEvent[];
}

const MAX_INCIDENTS = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_NOTE_LENGTH = 500;

const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.INCIDENTS_FILE || path.join(DATA_DIR, 'incidents.json');
const STORE_VERSION = 1;

interface StoreShape {
  v: number;
  incidents: Incident[];
}

// Pure: apply an operator action. Returns the updated incident or an error
// message (an invalid transition, an empty note).
export function applyAction(
  incident: Incident,
  action: IncidentAction,
  at: number,
  note = ''
): Incident | string {
  const stamp = new Date(at).toISOString();
  const event = (kind: IncidentEventKind, text: string): IncidentEvent => ({
    at: stamp,
    kind,
    text,
    author: 'operator'
  });
  switch (action) {
    case 'ack':
      if (incident.status !== 'open') return 'Only an open incident can be acknowledged';
      return {
        ...incident,
        status: 'acknowledged',
        events: [...incident.events, event('ack', 'Acknowledged')]
      };
    case 'note': {
      const text = note.trim();
      if (!text) return 'Write a note first';
      if (text.length > MAX_NOTE_LENGTH) return `Notes are limited to ${MAX_NOTE_LENGTH} characters`;
      return { ...incident, events: [...incident.events, event('note', text)] };
    }
    case 'resolve':
      if (incident.status === 'resolved') return 'Already resolved';
      return {
        ...incident,
        status: 'resolved',
        resolvedAt: stamp,
        events: [...incident.events, event('resolve', 'Resolved manually')]
      };
    case 'reopen':
      if (incident.status !== 'resolved') return 'Only a resolved incident can be reopened';
      return {
        ...incident,
        status: 'open',
        resolvedAt: null,
        events: [...incident.events, event('reopen', 'Reopened')]
      };
  }
}

export interface OpenInput {
  key: string;
  level: AlertLevel;
  title: string;
  rule: string | null;
  threshold?: AlertThreshold | null;
  notifyText: string;
}

class IncidentStore {
  private incidents: Incident[] = []; // newest first
  private sequence = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    try {
      const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')) as StoreShape;
      if (parsed?.v === STORE_VERSION && Array.isArray(parsed.incidents)) {
        this.incidents = parsed.incidents.slice(0, MAX_INCIDENTS);
      }
    } catch {
      // first run
    }
  }

  list(): Incident[] {
    return this.incidents.map(incident => ({ ...incident, events: [...incident.events] }));
  }

  get(id: string): Incident | null {
    const incident = this.incidents.find(candidate => candidate.id === id);
    return incident ? { ...incident, events: [...incident.events] } : null;
  }

  // The unresolved incident for an alert key, if any.
  current(key: string): Incident | null {
    return this.incidents.find(incident => incident.key === key && incident.status !== 'resolved') ?? null;
  }

  // Idempotent: a key that already has an unresolved incident keeps it.
  open(input: OpenInput, at: number = Date.now()): Incident {
    const existing = this.current(input.key);
    if (existing) return existing;
    this.sequence += 1;
    const stamp = new Date(at).toISOString();
    const incident: Incident = {
      id: `${at.toString(36)}${this.sequence.toString(36)}`,
      key: input.key,
      title: input.title,
      level: input.level,
      rule: input.rule,
      threshold: input.threshold ?? null,
      status: 'open',
      openedAt: stamp,
      resolvedAt: null,
      events: [
        { at: stamp, kind: 'trigger', text: `Rule fired: ${input.title}`, author: 'system' },
        { at: stamp, kind: 'notify', text: input.notifyText, author: 'system' }
      ]
    };
    this.incidents.unshift(incident);
    this.prune(at);
    this.save();
    return incident;
  }

  autoResolve(key: string, at: number = Date.now()): void {
    const incident = this.current(key);
    if (!incident) return;
    const stamp = new Date(at).toISOString();
    incident.status = 'resolved';
    incident.resolvedAt = stamp;
    incident.events.push({ at: stamp, kind: 'resolve', text: 'Recovered automatically', author: 'system' });
    this.save();
  }

  act(id: string, action: IncidentAction, note = '', at: number = Date.now()): Incident | string | null {
    const index = this.incidents.findIndex(incident => incident.id === id);
    if (index < 0) return null;
    const next = applyAction(this.incidents[index], action, at, note);
    if (typeof next === 'string') return next;
    this.incidents[index] = next;
    this.save();
    return { ...next, events: [...next.events] };
  }

  private prune(now: number): void {
    const oldest = now - RETENTION_MS;
    this.incidents = this.incidents
      .filter(incident => incident.status !== 'resolved' || new Date(incident.openedAt).getTime() >= oldest)
      .slice(0, MAX_INCIDENTS);
  }

  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const payload: StoreShape = { v: STORE_VERSION, incidents: this.incidents };
      void fs.promises
        .mkdir(DATA_DIR, { recursive: true })
        .then(() => fs.promises.writeFile(`${STORE_FILE}.tmp`, JSON.stringify(payload), 'utf-8'))
        .then(() => fs.promises.rename(`${STORE_FILE}.tmp`, STORE_FILE))
        .catch(() => {
          /* retried on the next change */
        });
    }, 1000);
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }
}

export function incidents(): IncidentStore {
  return processSingleton('incidents', () => new IncidentStore());
}
