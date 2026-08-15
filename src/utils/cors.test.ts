import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// allowedOrigins reads env at module load time. Reimport per case.
async function withOrigins(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = value;
  return import('@/utils/cors');
}

describe('corsHeaders', () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it('attaches ACAO only to allowed origins', async () => {
    const { corsHeaders } = await withOrigins('https://a.example,https://b.example');

    expect(corsHeaders('https://a.example')['Access-Control-Allow-Origin']).toBe('https://a.example');
    expect(corsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('always attaches Vary: Origin even when the origin is not allowed', async () => {
    const { corsHeaders } = await withOrigins('https://a.example');

    // The response varies by Origin, so Vary is needed even when ACAO isn't
    // attached, to keep caches from mixing across origins.
    expect(corsHeaders('https://evil.example').Vary).toBe('Origin');
    expect(corsHeaders(undefined).Vary).toBe('Origin');
    expect(corsHeaders('https://a.example').Vary).toBe('Origin');
  });

  it('ignores a trailing slash in the config', async () => {
    // The Origin header has no trailing slash, so one in .env would break matching.
    const { corsHeaders } = await withOrigins('https://a.example/');
    expect(corsHeaders('https://a.example')['Access-Control-Allow-Origin']).toBe('https://a.example');
  });

  it('tolerates whitespace around commas and empty entries', async () => {
    const { corsHeaders } = await withOrigins(' https://a.example ,, https://b.example ');

    expect(corsHeaders('https://b.example')['Access-Control-Allow-Origin']).toBe('https://b.example');
    // If an empty entry survived, a request with no Origin would pass through.
    expect(corsHeaders('')['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('allows only the local dev origin when unconfigured', async () => {
    const { corsHeaders } = await withOrigins(undefined);

    expect(corsHeaders('http://localhost:3000')['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(corsHeaders('https://a.example')['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('preserves the passed-in base headers as-is', async () => {
    const { corsHeaders } = await withOrigins('https://a.example');
    const headers = corsHeaders('https://a.example', { 'Content-Type': 'text/event-stream' });

    expect(headers['Content-Type']).toBe('text/event-stream');
  });
});
