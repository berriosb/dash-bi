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
  
  // The suite runs against `next dev`, as it always has.
  //
  // Running it against the production build (`next build && next start`)
  // was tried and reverted. Measured here, it is dramatically faster and
  // removed the local flakiness entirely — 40/40 on three consecutive
  // chromium runs, ~10 min down to ~3 min:
  //
  //   next dev      3.3s cold · 0.35s warm · ~10s with two browsers in flight
  //   next start    0.038s cold · 0.006s warm · flat under load
  //
  // and dev-mode first hits are worse still, because `next dev` compiles
  // each route on first request: `POST /api/auth/sign-up/email` measured
  // 19.4s cold against 992ms warm, `GET /api/auth/get-session` 36.4s
  // against 582ms. That is what the 15-20s assertion budgets were
  // measuring, and why the failing set moved between runs with no code
  // change.
  //
  // It was reverted because in CI that variant lost 5 tests, all in
  // firefox and mobile-safari, all inside the shared auth helper
  // (`signup.ok()` false, sign-in never leaving /login). Chromium stayed
  // fully green, and those two browsers cannot be reproduced on this
  // machine — firefox and webkit need system libraries (libicu74,
  // libxml2, libflite1) that require sudo to install. So the cause could
  // not be diagnosed, only observed, and main has been green on `next dev`.
  //
  // The worker cap and the 60s budget below are the part of the fix that
  // does not depend on the server type, and they are kept: they took the
  // local suite from 24/40 to 36/40 before the build variant was tried.
  //
  // Revisit with someone who can run all three browsers locally: if the
  // failures are not from the build variant, this is a ~3x speedup and a
  // strictly higher-fidelity target still on the table.
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Covers server boot. `pnpm dev` compiles routes on demand, so the
    // first run after a change pays that cost inside this budget.
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});