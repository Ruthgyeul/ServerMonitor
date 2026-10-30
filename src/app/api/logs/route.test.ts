import { beforeEach, describe, expect, it, vi } from 'vitest';

const readLogTail = vi.fn(async () => ({ lines: [], active: true }));
vi.mock('@/utils/collectors/logs', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/collectors/logs')>()),
  readLogTail
}));

const { GET } = await import('@/app/api/logs/route');

const call = (query: string) => GET(new Request(`http://localhost/api/logs?${query}`));
const ID = '0123456789abcdef0123456789abcdef';

beforeEach(() => readLogTail.mockClear());

describe('GET /api/logs', () => {
  it('returns the tail with the active flag', async () => {
    const response = await call('kind=unit&name=nginx.service');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { lines: [], active: true } });
    expect(readLogTail).toHaveBeenCalledWith('unit', 'nginx.service', 500, {});
  });

  it('passes a validated invocation or start time through', async () => {
    await call(`kind=unit&name=backup.service&invocation=${ID}`);
    expect(readLogTail).toHaveBeenLastCalledWith('unit', 'backup.service', 500, { invocation: ID });
    const since = new Date(Date.now() - 3_600_000).toISOString();
    await call(`kind=container&name=web&since=${encodeURIComponent(since)}`);
    expect(readLogTail).toHaveBeenLastCalledWith('container', 'web', 500, { since: Date.parse(since) });
  });

  it.each([
    'kind=unit&name=bad;name',
    'kind=unit&name=backup.service&invocation=xyz',
    `kind=container&name=web&invocation=${ID}`,
    'kind=unit&name=backup.service&since=yesterday'
  ])('rejects %s', async query => {
    const response = await call(query);
    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
    expect(readLogTail).not.toHaveBeenCalled();
  });
});
