import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// tests/unit/observability/*.test.ts → app/tests/unit/observability
// → app/tests/unit → app/tests → app → <repo> (5 levels)
const REPO_ROOT = resolve(__dirname, '../../../..');
const SENTRY_SERVER_CONFIG = resolve(REPO_ROOT, 'app/sentry.server.config.ts');

// Capture Sentry.init calls without actually sending events. We mock the
// module before loading the config so we can introspect the shape.
const sentyInitMock = vi.fn();
const sentryCaptureExceptionMock = vi.fn();
const sentryAddBreadcrumbMock = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  init: (...args: unknown[]) => sentyInitMock(...args),
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  addBreadcrumb: (...args: unknown[]) => sentryAddBreadcrumbMock(...args),
  withScope: (fn: (scope: { setTag: (k: string, v: string) => void }) => void) =>
    fn({ setTag: () => {} }),
}));

describe('app/sentry.server.config.ts (prod hardening)', () => {
  beforeEach(() => {
    vi.resetModules();
    sentyInitMock.mockClear();
  });

  it('exists and is a TypeScript module', () => {
    expect(existsSync(SENTRY_SERVER_CONFIG)).toBe(true);
    const source = readFileSync(SENTRY_SERVER_CONFIG, 'utf8');
    expect(source).toMatch(/Sentry\.init/);
  });

  it('disables Sentry when SENTRY_DSN is missing (dev / CI default)', async () => {
    const origDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      vi.resetModules();
      await import('../../../sentry.server.config');
      // Either not called at all, or called with enabled:false
      const calls = sentyInitMock.mock.calls;
      if (calls.length > 0) {
        expect(calls[0]?.[0]).toMatchObject({ enabled: false });
      }
    } finally {
      if (origDsn !== undefined) process.env.SENTRY_DSN = origDsn;
    }
  });

  it('initializes Sentry when SENTRY_DSN is set, with prod-grade hardening knobs', async () => {
    const origDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://abc123@o000.ingest.sentry.io/0000000';
    process.env.SENTRY_ENVIRONMENT = 'production';
    process.env.VERSION = 'v0.1.0';
    try {
      vi.resetModules();
      await import('../../../sentry.server.config');
      expect(sentyInitMock).toHaveBeenCalledTimes(1);
      const opts = sentyInitMock.mock.calls[0]?.[0] as Record<string, unknown>;

      // T4/T5: sendDefaultPii must be false so Sentry does NOT auto-collect
      // client IPs / cookies / user data on the server side.
      expect(opts.sendDefaultPii).toBe(false);

      // Release tagging so we can correlate errors with deploys.
      expect(opts.release).toBe('v0.1.0');

      // Performance + profiling both enabled in prod.
      expect(opts.tracesSampleRate).toBeCloseTo(0.1, 5);
      expect(opts.profilesSampleRate).toBeCloseTo(0.1, 5);

      // beforeSend must exist (secrets redaction hook).
      expect(typeof opts.beforeSend).toBe('function');

      // beforeSendTransaction must filter /api/health noise.
      expect(typeof opts.beforeSendTransaction).toBe('function');
      const txResult = (opts.beforeSendTransaction as (e: { transaction?: string }) => unknown)({
        transaction: '/api/health',
      });
      expect(txResult).toBeNull();

      // ignoreErrors: standard Next.js / IO noise list.
      expect(Array.isArray(opts.ignoreErrors)).toBe(true);
      const ignored = opts.ignoreErrors as string[];
      expect(ignored).toEqual(expect.arrayContaining(['NEXT_NOT_FOUND', 'NEXT_REDIRECT']));

      // Environment is plumbed through.
      expect(opts.environment).toBe('production');
      expect(opts.dsn).toBe('https://abc123@o000.ingest.sentry.io/0000000');
    } finally {
      if (origDsn !== undefined) process.env.SENTRY_DSN = origDsn;
      else delete process.env.SENTRY_DSN;
      delete process.env.VERSION;
      process.env.SENTRY_ENVIRONMENT = 'development';
    }
  });

  it('beforeSend redacts secret-shaped keys (T4/T5) before sending events', async () => {
    const origDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://abc@o.ingest.sentry.io/0';
    try {
      vi.resetModules();
      await import('../../../sentry.server.config');
      const opts = sentyInitMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      const beforeSend = opts.beforeSend as (event: unknown) => unknown;

      const event = {
        extra: {
          configEncrypted: 'ciphertext-that-must-not-leave-the-host',
          apiKey: 'sk-live-secret-1234567890',
          harmless: 'kept',
        },
        tags: {
          token: 'pat-na1-verysecret',
          orgId: 'kept-as-tag',
        },
        request: {
          cookies: { session: 'lemon' },
          headers: { authorization: 'Bearer topsecret' },
        },
      };

      const sanitized = beforeSend(event) as {
        extra: Record<string, unknown>;
        tags: Record<string, unknown>;
        request: { cookies: Record<string, unknown>; headers: Record<string, unknown> };
      };

      expect(sanitized.extra.configEncrypted).toBe('[Redacted]');
      expect(sanitized.extra.apiKey).toBe('[Redacted]');
      expect(sanitized.extra.harmless).toBe('kept');
      expect(sanitized.tags.token).toBe('[Redacted]');
      expect(sanitized.tags.orgId).toBe('kept-as-tag');
      expect(sanitized.request.cookies.session).toBe('[Redacted]');
      expect(sanitized.request.headers.authorization).toBe('[Redacted]');
    } finally {
      if (origDsn !== undefined) process.env.SENTRY_DSN = origDsn;
      else delete process.env.SENTRY_DSN;
    }
  });
});