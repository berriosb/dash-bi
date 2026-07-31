/**
 * Lock the post-signin navigation invariant.
 *
 * The login form MUST navigate via `window.location.href` (full reload) and
 * NOT via `router.push` (client-side navigation) after a successful sign-in.
 *
 * Why: better-auth's `/api/auth/sign-in/email` returns `Set-Cookie` headers
 * for the session. A subsequent `router.push()` can race the browser
 * processing those headers — the next server-side middleware check then
 * sees no session cookie and bounces the user back to /login. The CI e2e
 * (`tests/e2e/vertical-slice.spec.ts`) observed this flake on mobile-safari
 * where SameSite=Lax cookie commit is strictest.
 *
 * `window.location.href` forces a full reload, which guarantees the
 * browser commits Set-Cookie before the next request.
 *
 * If this test fails, the login flow has regressed to client-side
 * navigation and will reintroduce the e2e flake.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const loginPath = path.join(process.cwd(), 'src/app/(auth)/login/page.tsx');
const signupPath = path.join(process.cwd(), 'src/app/(auth)/signup/page.tsx');

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

describe('login/signup redirect uses full reload (cookie commit race fix)', () => {
  it('login page does NOT import useRouter', () => {
    const src = read(loginPath);
    expect(src).not.toMatch(/useRouter/);
  });

  it('login page assigns via window.location.href after signin', () => {
    const src = read(loginPath);
    expect(src).toMatch(/window\.location\.href\s*=\s*(?:body\.resumePath|redirect)/);
  });

  it('login page does NOT use router.push for the post-signin navigation', () => {
    const src = read(loginPath);
    // Strip line comments to avoid false positives from the explanatory comment.
    const codeOnly = src.replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/router\.push\(/);
  });

  it('signup page does NOT import useRouter', () => {
    const src = read(signupPath);
    expect(src).not.toMatch(/useRouter/);
  });

  it('signup page navigates via window.location.href after signup', () => {
    const src = read(signupPath);
    // The only redirect target is /onboarding.
    expect(src).toMatch(/window\.location\.href\s*=\s*['"]\/onboarding['"]/);
  });
});