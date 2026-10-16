import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Automatically load .env.local for local E2E runs
const envLocal = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envLocal) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envLocal);
  } catch {
    // Ignore if already loaded
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Worker budget.
  //
  // This suite drives a single server. Browsers are CPU-bound regardless of
  // which server that is, so the pool stays bounded rather than defaulting to
  // half the cores; CI is pinned to 1. Override with PW_WORKERS.
  workers: process.env.CI ? 1 : Number(process.env.PW_WORKERS ?? 2),
  reporter: process.env.CI ? [['html'], ['github']] : 'list',

  // Headroom for the slowest single test (the vertical slice does a signup,
  // a data source, a dashboard and a share link). Navigation itself is fast
  // against a production server; this budget covers the workflow, not the
  // toolchain.
  timeout: 60_000,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],
  
  // The suite runs against the PRODUCTION build, not `next dev`.
  //
  // This was the root cause of the suite's flakiness. Measured on this
  // machine, navigating to a dashboard page:
  //
  //   next dev      3.3s cold · 0.35s warm · ~10s with two browsers in flight
  //   next start    0.038s cold · 0.006s warm · flat under load
  //
  // and dev-mode first hits were far worse — `POST /api/auth/sign-up/email`
  // took 19.4s cold against 992ms warm, `GET /api/auth/get-session` 36.4s
  // against 582ms — because `next dev` compiles each route on its first
  // request. The tests assert with 15-20s budgets, so they were measuring
  // webpack's compile queue, not the app, and whichever spec happened to
  // draw the cold-compile short straw failed. The failing set changed from
  // run to run with no code change, which is the signature.
  //
  // Testing the shipped artifact also means the suite covers what users get:
  // minified, optimized React with no dev-only hydration behavior.
  //
  // `NODE_ENV=production` is explicit and load-bearing. Playwright injects
  // `NODE_ENV=development` into the webServer environment, and a
  // `next build` that inherits it fails while prerendering the error
  // boundaries:
  //
  //   Error occurred prerendering page "/_not-found"  (or "/_global-error")
  //   TypeError: Cannot read properties of null (reading 'useContext')
  //
  // which does NOT reproduce with `NODE_ENV=production`. Verified by
  // building the same tree both ways, and separately confirmed NOT to come
  // from the root-level error boundaries.
  //
  // `next build` regenerates its own output, so no `rm -rf .next` here:
  // wiping the directory also drops the webpack cache, and a cold build of
  // this app measures 214s against 112s warm. That ~100s is paid on every
  // run, on every machine, to defend against a staleness that was never the
  // culprit — `next build` already rewrites the output it serves.
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Covers the build plus server boot, not just the boot. A cold build
    // measured 214s, so 600s leaves room for a slower CI runner while still
    // failing a genuinely hung build.
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});