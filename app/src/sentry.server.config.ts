// Sprint 1.5: Sentry server config stub.
// The full Sentry config depends on SENTRY_DSN being set. When it isn't
// (default in dev/CI), we skip initialization so Next.js boots cleanly.
// See app/src/instrumentation.ts for the entrypoint.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    tracesSampleRate: 0.1,
  });
}