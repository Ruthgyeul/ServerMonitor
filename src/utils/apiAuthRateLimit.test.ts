import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireApiAuth } from '@/utils/apiAuth';

// Isolated from apiAuth.test.ts: the auth-failure limiter is a module-level
// singleton, and Vitest gives each test file its own module registry, so the
// burst budget consumed here doesn't leak into the other file's assertions.

const ORIGINAL = process.env.DASHBOARD_PASSWORD;

beforeEach(() => {
  process.env.DASHBOARD_PASSWORD = 'pw';
  delete process.env.API_AUTH_TOKEN;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = ORIGINAL;
});

function wrongGuess(): Request {
  return new Request('http://localhost/api/alerts', {
    headers: { authorization: 'Bearer definitely-wrong' }
  });
}

describe('requireApiAuth failed-guess rate limiting', () => {
  it('429s after repeated wrong credentials, so the derived token cannot be brute-forced', () => {
    // The limiter allows a small burst before throttling. Keep guessing until it
    // trips; a bounded loop proves it does trip rather than allowing unlimited tries.
    let saw429 = false;
    let last401 = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = requireApiAuth(wrongGuess());
      expect(result).not.toBeNull();
      if (result?.status === 429) {
        saw429 = true;
        break;
      }
      expect(result?.status).toBe(401);
      last401 += 1;
    }
    expect(saw429).toBe(true);
    // The burst let a few 401s through before the throttle engaged.
    expect(last401).toBeGreaterThan(0);
  });

  it('does not charge the budget when no credential is presented', () => {
    // A fresh browser (no cookie/bearer) must always get a clean 401 so the
    // dashboard can redirect to /login, even after guesses have tripped the limiter.
    for (let i = 0; i < 20; i += 1) requireApiAuth(wrongGuess());
    const anonymous = requireApiAuth(new Request('http://localhost/api/alerts'));
    expect(anonymous?.status).toBe(401);
  });
});
