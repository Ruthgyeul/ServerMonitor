import { spawn as nodeSpawn } from 'child_process';

import type { LogLine, LogSourceKind } from '@/types/system';
import { parseDockerLogs, parseJournal } from '@/utils/collectors/logs';
import { EXEC_ENV } from '@/utils/collectors/shell';
import { processSingleton } from '@/utils/processSingleton';

// Live follow for the log drawer: `journalctl -f` / `docker logs -f` piped to
// the browser as Server-Sent Events, one `data:` event per batch of new lines.
// Each stream holds a child process, so streams are capped per client, end on
// their own after 30 minutes, and kill the child however they end.

export const MAX_STREAMS_PER_CLIENT = 2;
export const STREAM_MAX_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 15_000;

// Pure: the follow command for a validated source (new lines only — the drawer
// already has the tail from /api/logs).
export function followCommand(kind: LogSourceKind, name: string): { file: string; args: string[] } {
  return kind === 'unit'
    ? { file: 'journalctl', args: ['-u', name, '-f', '-n', '0', '-o', 'json', '--no-pager'] }
    : { file: 'docker', args: ['logs', '-f', '--timestamps', '--tail', '0', name] };
}

// Pure: turns arbitrary output chunks into whole lines, holding a partial
// last line until the rest of it arrives.
export function lineSplitter(onText: (text: string) => void): (chunk: string) => void {
  let pending = '';
  return chunk => {
    pending += chunk;
    const cut = pending.lastIndexOf('\n');
    if (cut < 0) return;
    const complete = pending.slice(0, cut);
    pending = pending.slice(cut + 1);
    if (complete.trim()) onText(complete);
  };
}

// Open streams per client key (see clientIp in rateLimit.ts).
export class StreamSlots {
  private readonly open = new Map<string, number>();

  acquire(client: string): boolean {
    const count = this.open.get(client) ?? 0;
    if (count >= MAX_STREAMS_PER_CLIENT) return false;
    this.open.set(client, count + 1);
    return true;
  }

  release(client: string): void {
    const count = (this.open.get(client) ?? 1) - 1;
    if (count > 0) this.open.set(client, count);
    else this.open.delete(client);
  }
}

export function streamSlots(): StreamSlots {
  return processSingleton('logStreamSlots', () => new StreamSlots());
}

// The part of a child process the stream uses (lets tests pass a fake).
export interface FollowProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'close' | 'error', listener: () => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}
export type SpawnFollow = (file: string, args: string[]) => FollowProcess;

const defaultSpawn: SpawnFollow = (file, args) =>
  nodeSpawn(file, args, { env: EXEC_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

export interface StreamOptions {
  signal?: AbortSignal;
  spawn?: SpawnFollow;
  maxMs?: number;
  // Called exactly once when the stream ends, for whatever reason.
  onClose?: () => void;
}

export function openLogStream(
  kind: LogSourceKind,
  name: string,
  { signal, spawn = defaultSpawn, maxMs = STREAM_MAX_MS, onClose }: StreamOptions = {}
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let finish: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const sendLines = (lines: LogLine[]) => {
        if (lines.length > 0) send(`data: ${JSON.stringify(lines)}\n\n`);
      };

      const { file, args } = followCommand(kind, name);
      const child = spawn(file, args);
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      const deadline = setTimeout(() => close('timeout'), maxMs);

      function close(reason: 'timeout' | 'exit' | 'abort' | 'cancel') {
        if (closed) return;
        // Tell the drawer why, so it can fall back to polling (or not).
        if (reason === 'timeout' || reason === 'exit')
          send(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`);
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        signal?.removeEventListener('abort', onAbort);
        child.kill('SIGTERM');
        if (reason !== 'cancel') {
          try {
            controller.close();
          } catch {
            // already closed by the consumer
          }
        }
        onClose?.();
      }
      const onAbort = () => close('abort');
      finish = () => close('cancel');

      const parse = (text: string) => (kind === 'unit' ? parseJournal(text) : parseDockerLogs(text));
      child.stdout?.setEncoding('utf-8');
      child.stdout?.on(
        'data',
        lineSplitter(text => sendLines(parse(text)))
      );
      // docker replays the container's stderr on ours; journalctl's stderr is diagnostics only.
      if (kind === 'container') {
        child.stderr?.setEncoding('utf-8');
        child.stderr?.on(
          'data',
          lineSplitter(text => sendLines(parse(text)))
        );
      }
      child.on('close', () => close('exit'));
      child.on('error', () => close('exit'));

      if (signal?.aborted) close('abort');
      else signal?.addEventListener('abort', onAbort);
      send(': open\n\n');
    },
    cancel() {
      finish?.();
    }
  });
}
