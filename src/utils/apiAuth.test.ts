import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expectedSessionToken,
  requireApiAuth,
  sessionCookieValue,
  sessionTokenFromPassword
} from '@/utils/apiAuth';

// The gate reads process.env on every call, so each test sets exactly the
// variables it needs and clears both afterwards.
const ORIGINAL = {
  token: process.env.API_AUTH_TOKEN,
  password: process.env.DASHBOARD_PASSWORD
};

function setEnv(env: { token?: string; password?: string }) {
  if (env.token === undefined) delete process.env.API_AUTH_TOKEN;
  else process.env.API_AUTH_TOKEN = env.token;
  if (env.password === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = env.password;
}

function request(headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request('http://localhost/api/system', { method, headers });
}

beforeEach(() => setEnv({}));

afterEach(() => {
  setEnv({ token: ORIGINAL.token, password: ORIGINAL.password });
});

describe('sessionTokenFromPassword', () => {
  it('is a stable, non-reversible 64-char hex digest', () => {
    const token = sessionTokenFromPassword('hunter2');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(sessionTokenFromPassword('hunter2'));
    expect(token).not.toContain('hunter2');
  });

  it('differs per password', () => {
    expect(sessionTokenFromPassword('a')).not.toBe(sessionTokenFromPassword('b'));
  });
});

describe('expectedSessionToken', () => {
  it('is null when neither secret is set (gate off)', () => {
    expect(expectedSessionToken()).toBeNull();
  });

  it('prefers API_AUTH_TOKEN verbatim', () => {
    setEnv({ token: 'raw-token', password: 'pw' });
    expect(expectedSessionToken()).toBe('raw-token');
  });

  it('derives from DASHBOARD_PASSWORD when only it is set', () => {
    setEnv({ password: 'pw' });
    expect(expectedSessionToken()).toBe(sessionTokenFromPassword('pw'));
  });

  it('treats blank/whitespace secrets as unset', () => {
    setEnv({ token: '   ', password: '' });
    expect(expectedSessionToken()).toBeNull();
  });
});

describe('sessionCookieValue', () => {
  it('is the derived token in password-only mode', () => {
    setEnv({ password: 'pw' });
    expect(sessionCookieValue()).toBe(sessionTokenFromPassword('pw'));
  });

  it('is empty when the gate is off', () => {
    expect(sessionCookieValue()).toBe('');
  });
});

describe('requireApiAuth', () => {
  it('lets everything through when the gate is off', () => {
    expect(requireApiAuth(request())).toBeNull();
  });

  it('401s an anonymous request when DASHBOARD_PASSWORD alone is set', () => {
    setEnv({ password: 'pw' });
    const result = requireApiAuth(request());
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it('accepts the derived cookie in password-only mode', () => {
    setEnv({ password: 'pw' });
    const cookie = sessionTokenFromPassword('pw');
    expect(requireApiAuth(request({ cookie: `api_auth_token=${cookie}` }))).toBeNull();
  });

  it('rejects the raw password as a cookie value', () => {
    setEnv({ password: 'pw' });
    expect(requireApiAuth(request({ cookie: 'api_auth_token=pw' }))?.status).toBe(401);
  });

  it('accepts a bearer token in token mode', () => {
    setEnv({ token: 'raw-token' });
    expect(requireApiAuth(request({ authorization: 'Bearer raw-token' }))).toBeNull();
  });

  it('accepts the token cookie in token mode', () => {
    setEnv({ token: 'raw-token' });
    expect(requireApiAuth(request({ cookie: 'x=1; api_auth_token=raw-token' }))).toBeNull();
  });

  it('rejects a wrong token', () => {
    setEnv({ token: 'raw-token' });
    expect(requireApiAuth(request({ authorization: 'Bearer nope' }))?.status).toBe(401);
  });

  it('URL-decodes the cookie value', () => {
    setEnv({ token: 'a b' });
    expect(requireApiAuth(request({ cookie: 'api_auth_token=a%20b' }))).toBeNull();
  });

  it('returns 401 (not a 500) on a malformed cookie encoding', () => {
    setEnv({ token: 'raw-token' });
    // A trailing "%" is an invalid percent-escape; decodeURIComponent throws.
    // It must be treated as no credential, not crash the route.
    const result = requireApiAuth(request({ cookie: 'api_auth_token=abc%' }));
    expect(result?.status).toBe(401);
  });

  it('lets a CORS preflight (OPTIONS) through even when gated', () => {
    setEnv({ password: 'pw' });
    expect(requireApiAuth(request({}, 'OPTIONS'))).toBeNull();
  });
});
