// @vitest-environment happy-dom
/**
 * Lock the dashboard detail page infinite-render invariant.
 *
 * Sprint 1.5: the dashboard detail page (`src/app/(dashboard)/dashboards/[id]/page.tsx`)
 * subscribes to `useDashboardStore` via an aggregate selector that returns
 * a new object literal each call. With zustand's default `Object.is`
 * equality, every render produces a new reference and triggers another
 * render → setDashboard → invalidate `['dashboard', id]` query → refetch
 * → setDashboard → ... → React "Maximum update depth exceeded" error.
 *
 * Chromium on CI hit this loop and starved the dev server, which is why
 * the e2e `vertical-slice.spec.ts` login redirect test failed with
 * `34 × unexpected value "http://localhost:3000/login"` (mobile-safari
 * never received a response because chromium was hogging the server).
 *
 * The fix wraps the aggregate selector in `useShallow` so zustand uses
 * shallow field equality instead of `Object.is`.
 *
 * If this test fails, the dashboard detail page has regressed to the
 * raw object-literal selector and will reintroduce the infinite loop.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const pagePath = path.join(
  process.cwd(),
  'src/app/(dashboard)/dashboards/[id]/page.tsx',
);

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

describe('dashboard detail page aggregate selector uses useShallow', () => {
  it('imports useShallow from zustand', () => {
    const src = read(pagePath);
    expect(src).toMatch(
      /import\s*\{\s*useShallow\s*\}\s*from\s*['"]zustand\/react\/shallow['"]/,
    );
  });

  it('wraps the multi-field storeState selector in useShallow(...)', () => {
    const src = read(pagePath);
    // The aggregate selector returns an object with id, title, widgets,
    // etc. — without useShallow, every call yields a new reference and
    // breaks Object.is equality.
    expect(src).toMatch(
      /useDashboardStore\(\s*useShallow\(\(s\)\s*=>\s*\(\{[\s\S]*?id:\s*s\.id[\s\S]*?widgets:\s*s\.widgets[\s\S]*?\}\)/,
    );
  });

  it('does not use the bare object-literal selector anywhere else in the file', () => {
    const src = read(pagePath);
    // Find any remaining `useDashboardStore((s) => ({...}))` that is
    // NOT wrapped in useShallow — these would all reintroduce the loop.
    // Match a single selector that lacks useShallow wrapping.
    const offenders = src.match(
      /useDashboardStore\(\s*\(\s*s\s*\)\s*=>\s*\(\{[\s\S]*?\}\)\)/g,
    );
    expect(offenders ?? []).toEqual([]);
  });
});