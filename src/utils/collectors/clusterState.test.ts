import { describe, expect, it } from 'vitest';

import { appendNet, errorCode, NET_POINTS, nodeMemory, recordNodeOk } from '@/utils/collectors/clusterState';

describe('errorCode', () => {
  it('names timeouts and connection errors', () => {
    expect(errorCode(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('ETIMEDOUT');
    expect(errorCode(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))).toBe(
      'ECONNREFUSED'
    );
    expect(errorCode(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }))).toBe(
      'ETIMEDOUT'
    );
    expect(errorCode(new Error('weird'))).toBe('Connection failed');
  });
});

describe('net history', () => {
  it('keeps one point per second and the last 30', () => {
    let history = appendNet([], { at: new Date(0).toISOString(), down: 1, up: 1 });
    history = appendNet(history, { at: new Date(100).toISOString(), down: 2, up: 2 });
    expect(history).toHaveLength(1);
    for (let index = 1; index <= 40; index += 1) {
      history = appendNet(history, { at: new Date(index * 1000).toISOString(), down: index, up: 0 });
    }
    expect(history).toHaveLength(NET_POINTS);
    expect(history.at(-1)!.down).toBe(40);
  });

  it('remembers when a node last answered', () => {
    expect(nodeMemory('pi').lastOkAt).toBeNull();
    recordNodeOk('pi', 3, 1, 5000);
    expect(nodeMemory('pi')).toMatchObject({ lastOkAt: 5000, net: [{ down: 3, up: 1 }] });
  });
});
