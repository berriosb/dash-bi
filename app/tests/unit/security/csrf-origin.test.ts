import { describe, it, expect } from 'vitest';
import { checkRequestOrigin } from '@/lib/security/csrf';

/**
 * The CSRF gate.
 *
 * The session cookie is `SameSite=Lax`, which stops a POST coming from a
 * DIFFERENT registrable domain. It does NOT stop a same-site attacker: a
 * page on `evil.example.com` can POST to `app.example.com` — the cookie
 * travels, because the site is the same. And a cross-origin `fetch` with
 * `Content-Type: text/plain` does not trigger a preflight, and `req.json()`
 * parses the body whatever the content type says.
 *
 * So the app's own mutating routes check the `Origin` header: a browser
 * always sends it on a state-changing request, and it must be one of ours.
 */
const REQUEST_ORIGIN = 'https://bi.example.com';

function check(overrides: Partial<Parameters<typeof checkRequestOrigin>[0]> = {}) {
  return checkRequestOrigin({
    method: 'POST',
    origin: null,
    referer: null,
    requestOrigin: REQUEST_ORIGIN,
    trustedOrigins: [],
    ...overrides,
  });
}

describe('checkRequestOrigin', () => {
  it('allows the safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const verdict = check({ method, origin: 'https://evil.example.com' });
      expect(verdict.allowed, method).toBe(true);
      expect(verdict.reason).toBe('safe-method');
    }
  });

  it('allows a state-changing request from our own origin', () => {
    const verdict = check({ origin: REQUEST_ORIGIN });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe('same-origin');
  });

  it('rejects a state-changing request from another origin', () => {
    const verdict = check({ origin: 'https://evil.example.com' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('foreign-origin');
  });

  it('rejects a same-site attacker', () => {
    // Same registrable domain: SameSite=Lax lets the cookie travel.
    const verdict = check({ origin: 'https://app.example.com' });
    expect(verdict.allowed).toBe(false);
  });

  it('rejects an opaque origin', () => {
    // `Origin: null` is what a sandboxed iframe or a `data:` page sends.
    const verdict = check({ origin: 'null' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('null-origin');
  });

  it('rejects a malformed origin', () => {
    const verdict = check({ origin: 'not-an-origin' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('malformed-origin');
  });

  it('accepts an origin that differs only in the default port', () => {
    const verdict = check({
      origin: 'https://bi.example.com:443',
      requestOrigin: 'https://bi.example.com',
    });
    expect(verdict.allowed).toBe(true);
  });

  it('accepts a configured trusted origin', () => {
    const verdict = check({
      origin: 'https://app.example.com',
      trustedOrigins: ['https://app.example.com'],
    });
    expect(verdict.allowed).toBe(true);
  });

  it('falls back to the referer when there is no origin header', () => {
    const verdict = check({ referer: `${REQUEST_ORIGIN}/dashboards/abc` });
    expect(verdict.allowed).toBe(true);
  });

  it('rejects a foreign referer when there is no origin header', () => {
    const verdict = check({ referer: 'https://evil.example.com/attack' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('foreign-referer');
  });

  it('allows a request with neither origin nor referer', () => {
    // Not a browser-initiated state change: curl, a server-to-server
    // call, a test client. There is no ambient credential to abuse.
    const verdict = check();
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe('no-origin-header');
  });

  it('checks every state-changing method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const verdict = check({ method, origin: 'https://evil.example.com' });
      expect(verdict.allowed, method).toBe(false);
    }
  });
});
