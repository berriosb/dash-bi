import { describe, it, expect } from 'vitest';
import { __testing } from '@/middleware';

const { isPublicPath, PUBLIC_PATHS } = __testing;

describe('middleware PUBLIC_PATHS (security boundary)', () => {
  // Lock the public path set. If you add a route that should be public,
  // update this list AND PUBLIC_PATHS together — silent regression if not.
  const PUBLIC_PATH_CASES: ReadonlyArray<readonly [string, boolean]> = [
    // Auth pages — must always be reachable without a session.
    ['/', true],
    ['/login', true],
    ['/signup', true],
    ['/magic-link', true],
    ['/forgot-password', true],
    ['/reset-password', true],
    // Public dashboard showcase / shared links — accessible to anonymous users.
    ['/demo/dashboard', true],
    ['/share/abc123', true],
    // API endpoints that handle auth themselves or are explicitly public.
    ['/api/auth/sign-in', true],
    ['/api/health', true],
    ['/api/public/something', true],

    // Protected routes — must redirect to /login when session cookie missing.
    ['/dashboards', false],
    ['/dashboards/abc123', false],
    ['/data-sources', false],
    ['/data-sources/abc123', false],
    ['/settings', false],
    ['/settings/llm-usage', false],
    ['/settings/audit', false],
    ['/onboarding', false],
    ['/onboarding/step', false],
  ] as const;

  it.each(PUBLIC_PATH_CASES)(
    'isPublicPath(%j) === %s',
    (pathname, expected) => {
      expect(isPublicPath(pathname)).toBe(expected);
    }
  );

  it('does not silently expose a route by a partial prefix collision', () => {
    // /api/publications is NOT /api/public/ — trailing slash matters and
    // PUBLIC_PATHS uses startsWith. This asserts the prefix collision
    // boundary is intentional and not a TODO.
    expect(isPublicPath('/api/publications')).toBe(false);
    expect(isPublicPath('/dashboards-extra')).toBe(false);
    expect(isPublicPath('/loginv2')).toBe(false);
  });

  it('exposes a non-empty public path set', () => {
    // If someone refactors and accidentally empties PUBLIC_PATHS, every
    // visitor gets redirected to /login. Loud failure beats silent.
    expect(PUBLIC_PATHS.length).toBeGreaterThan(0);
    expect(PUBLIC_PATHS).toContain('/login');
    expect(PUBLIC_PATHS).toContain('/');
    expect(PUBLIC_PATHS).toContain('/demo/');
  });
});
