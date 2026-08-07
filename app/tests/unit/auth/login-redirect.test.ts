/**
 * Lock the post-auth navigation invariant.
 *
 * better-auth sets the session cookie in the sign-in response. A full page
 * navigation gives the browser time to commit that cookie before middleware
 * evaluates the protected destination, which is important on WebKit.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const loginPath = path.join(process.cwd(), 'src/app/(auth)/login/page.tsx');
const signupPath = path.join(process.cwd(), 'src/app/(auth)/signup/page.tsx');

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

describe('post-auth navigation commits the session cookie first', () => {
  it('login does not use client-side router navigation', () => {
    const src = read(loginPath);
    const codeOnly = src.replace(/\/\/.*$/gm, '');

    expect(src).not.toMatch(/useRouter/);
    expect(src).toMatch(/window\.location\.href\s*=\s*(?:body\.resumePath|redirect)/);
    expect(codeOnly).not.toMatch(/router\.push\(/);
  });

  it('signup uses a full navigation after account creation', () => {
    const src = read(signupPath);

    expect(src).not.toMatch(/useRouter/);
    expect(src).toMatch(/window\.location\.href\s*=\s*['"]\/onboarding['"]/);
  });
});
