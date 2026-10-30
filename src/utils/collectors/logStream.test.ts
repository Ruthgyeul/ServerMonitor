import { EventEmitter, PassThrough } from 'stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  followCommand,
  lineSplitter,
  MAX_STREAMS_PER_CLIENT,
  openLogStream,
  StreamSlots,
  type FollowProcess
} from '@/utils/collectors/logStream';

class FakeChild extends EventEmitter implements FollowProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}

function fakeSpawn() {
  const child = new FakeChild();
  const spawn = vi.fn(() => child);
  return { child, spawn };
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('followCommand', () => {
  it('follows new lines only, without a shell', () => {
    expect(followCommand('unit', 'nginx.service')).toEqual({
      file: 'journalctl',
      args: ['-u', 'nginx.service', '-f', '-n', '0', '-o', 'json', '--no-pager']
    });
    expect(followCommand('container', 'web').args).toEqual([
      'logs',
      '-f',
      '--timestamps',
      '--tail',
      '0',
      'web'
    ]);
  });
});

describe('lineSplitter', () => {
  it('holds a partial line until it completes', () => {
    const seen: string[] = [];
    const push = lineSplitter(text => seen.push(text));
    push('one\ntw');
    push('o\nthr');
    expect(seen).toEqual(['one', 'two']);
    push('ee\n');
    expect(seen).toEqual(['one', 'two', 'three']);
  });
});

describe('StreamSlots', () => {
  it('caps open streams per client and frees them on release', () => {
    const slots = new StreamSlots();
    for (let i = 0; i < MAX_STREAMS_PER_CLIENT; i++) expect(slots.acquire('a')).toBe(true);
    expect(slots.acquire('a')).toBe(false);
    expect(slots.acquire('b')).toBe(true);
    slots.release('a');
    expect(slots.acquire('a')).toBe(true);
  });
});

describe('openLogStream', () => {
  it('sends parsed lines as SSE data events', async () => {
    const { child, spawn } = fakeSpawn();
    const reader = openLogStream('container', 'web', { spawn }).getReader();
    expect(await readChunk(reader)).toBe(': open\n\n');
    child.stdout.write('2026-10-29T12:00:00.5Z GET / 200\n');
    const event = await readChunk(reader);
    expect(event.startsWith('data: ')).toBe(true);
    expect(JSON.parse(event.slice(6))).toEqual([
      { at: '2026-10-29T12:00:00.500Z', level: 'info', message: 'GET / 200' }
    ]);
    await reader.cancel();
  });

  it('kills the child and closes once when the request aborts', async () => {
    const { child, spawn } = fakeSpawn();
    const abort = new AbortController();
    const onClose = vi.fn();
    const reader = openLogStream('unit', 'nginx.service', {
      spawn,
      signal: abort.signal,
      onClose
    }).getReader();
    await readChunk(reader);
    abort.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect((await reader.read()).done).toBe(true);
    child.emit('close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ends after the time limit, telling the client why', async () => {
    vi.useFakeTimers();
    const { child, spawn } = fakeSpawn();
    const onClose = vi.fn();
    const reader = openLogStream('unit', 'nginx.service', { spawn, maxMs: 1000, onClose }).getReader();
    await readChunk(reader);
    vi.advanceTimersByTime(1000);
    expect(await readChunk(reader)).toBe('event: end\ndata: {"reason":"timeout"}\n\n');
    expect(child.kill).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('kills the child when the consumer cancels', async () => {
    const { child, spawn } = fakeSpawn();
    const onClose = vi.fn();
    const reader = openLogStream('unit', 'nginx.service', { spawn, onClose }).getReader();
    await reader.cancel();
    expect(child.kill).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
