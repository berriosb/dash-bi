// Server-side Sentry configuration (post-MVP hardening).
//
// Mirrors the client config in app/sentry.client.config.ts and adds:
//   - sendDefaultPii: false        — T4/T5: no auto-collection of PII
//   - release tagging from VERSION  — correlate errors with deploys
//   - beforeSend secret redaction   — defense in depth on top of Pino redact
//   - beforeSendTransaction filter  — drop /api/health noise
//   - profilesSampleRate + ignoreErrors — parity with the client config
//
// Sentry is opt-in: when SENTRY_DSN is missing (dev / CI / staging
// without a DSN), we DO NOT call init at all so the SDK's global
// state stays inert and `Sentry.captureException` is a no-op.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const environment = process.env.SENTRY_ENVIRONMENT ?? 'development';
  const inProduction = environment === 'production';

  Sentry.init({
    dsn,
    environment,

    // Release tagging: fall back to SENTRY_RELEASE (CI override) and
    // then to the container VERSION baked at deploy time. Undefined in
    // dev, which Sentry handles gracefully.
    release: process.env.SENTRY_RELEASE ?? process.env.VERSION,

    // Performance + profiling. 10% in prod is enough signal without
    // saturating the Sentry quota; 100% in staging for fidelity.
    tracesSampleRate: inProduction ? 0.1 : 1.0,
    profilesSampleRate: inProduction ? 0.1 : 1.0,

    // T4/T5: never auto-collect client IPs, headers, or cookies. Any
    // identifier we want Sentry to see must be set explicitly via
    // `setUser` / `setTag` after we have redacted PII ourselves.
    sendDefaultPii: false,

    // Drop the /api/health transaction — monitoring hits it every 30s
    // and the volume drowns out useful signal.
    beforeSendTransaction(event) {
      if (event.transaction === '/api/health') return null;
      return event;
    },

    // Defense-in-depth on top of Pino redact. If anyone in the future
    // attaches a secret-shaped key to `extra`, `tags`, or `contexts`,
    // we scrub it before the event leaves the host. The allowlist of
    // keys we touch is intentionally short — when in doubt, redact.
    beforeSend(event) {
      const SECRET_KEYS = new Set([
        'configencrypted',
        'apikey',
        'accesstoken',
        'refreshtoken',
        'sessiontoken',
        'token',
        'password',
        'secret',
        'authorization',
        'cookie',
        'set-cookie',
      ]);

      const scrub = (obj: Record<string, unknown> | undefined) => {
        if (!obj) return;
        for (const k of Object.keys(obj)) {
          if (SECRET_KEYS.has(k.toLowerCase())) {
            obj[k] = '[Redacted]';
          }
        }
      };

      // Redact the entire contents of `request.cookies` and
      // `request.headers` — every header/cookie value is potentially
      // sensitive (session IDs, auth tokens, traceparent). Operators
      // never need them to triage an exception.
      const scrubAll = (obj: Record<string, unknown> | undefined) => {
        if (!obj) return;
        for (const k of Object.keys(obj)) {
          obj[k] = '[Redacted]';
        }
      };

      scrub(event.extra as Record<string, unknown> | undefined);
      scrub(event.tags as Record<string, unknown> | undefined);
      scrub((event.contexts as Record<string, unknown> | undefined)?.['data'] as
        | Record<string, unknown>
        | undefined);
      scrubAll(event.request?.cookies as Record<string, unknown> | undefined);
      scrubAll(event.request?.headers as Record<string, unknown> | undefined);

      return event;
    },

    // Standard Next.js / IO noise that isn't actionable.
    ignoreErrors: [
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      'ECONNRESET',
    ],
  });
}