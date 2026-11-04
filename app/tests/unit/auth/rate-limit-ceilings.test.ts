import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The auth rate limiter is a production safeguard: it is what stops
 * credential stuffing against the sign-in and sign-up endpoints. Its
 * ceilings used to be hardcoded, which meant the e2e suite — whose three
 * Playwright projects all sign up from 127.0.0.1 — hit the production
 * ceiling and failed on a 429 that had nothing to do with the code under
 * test.
 *
 * These tests pin two things:
 *   1. the production defaults are unchanged, so a deployment keeps its
 *      safeguard;
 *   2. an override actually moves the ceiling, and a malformed override
 *      falls back to the default instead of silently disabling it.
 */

const ENV_KEYS = [
  'AUTH_RATE_LIMIT_SIGN_UP_MAX',
  'AUTH_RATE_LIMIT_SIGN_IN_MAX',
  'AUTH_RATE_LIMIT_MAX',
] as const;

async function loadRateLimit() {
  // The config module reads process.env at import time, so each case
  // needs a fresh module instance.
  const module = await import('@/lib/auth/config');
  const auth = module.auth as unknown as {
    options: {
      rateLimit: {
        max: number;
        customRules: Record<string, { window: number; max: number }>;
      };
    };
  };
  return auth.options.rateLimit;
}

function signUpMax(rateLimit: Awaited<ReturnType<typeof loadRateLimit>>): number {
  return rateLimit.customRules['/sign-up/email']?.max ?? -1;
}

function signInMax(rateLimit: Awaited<ReturnType<typeof loadRateLimit>>): number {
  return rateLimit.customRules['/sign-in/email']?.max ?? -1;
}

describe('auth rate limit ceilings', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    // The config module reads process.env at import time, so each case
    // needs a fresh module instance.
    vi.resetModules();
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps the production ceilings when nothing overrides them', async () => {
    const rateLimit = await loadRateLimit();

    expect(rateLimit.max).toBe(30);
    expect(signUpMax(rateLimit)).toBe(3);
    expect(signInMax(rateLimit)).toBe(5);
  });

  it('lets a test environment raise the ceilings', async () => {
    process.env.AUTH_RATE_LIMIT_SIGN_UP_MAX = '200';
    process.env.AUTH_RATE_LIMIT_SIGN_IN_MAX = '200';
    process.env.AUTH_RATE_LIMIT_MAX = '1000';

    const rateLimit = await loadRateLimit();

    expect(rateLimit.max).toBe(1000);
    expect(signUpMax(rateLimit)).toBe(200);
    expect(signInMax(rateLimit)).toBe(200);
  });

  it('ignores a malformed override instead of disabling the limit', async () => {
    process.env.AUTH_RATE_LIMIT_SIGN_UP_MAX = 'not-a-number';
    process.env.AUTH_RATE_LIMIT_SIGN_IN_MAX = '0';
    process.env.AUTH_RATE_LIMIT_MAX = '-5';

    const rateLimit = await loadRateLimit();

    // A typo in the environment must not open the door: the default
    // ceilings are what a production deployment keeps.
    expect(rateLimit.max).toBe(30);
    expect(signUpMax(rateLimit)).toBe(3);
    expect(signInMax(rateLimit)).toBe(5);
  });
});