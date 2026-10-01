import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getEnv, type Env } from '@/lib/env';

describe('Environment validation', () => {
  it('rejects missing required vars', () => {
    const originalEnv = process.env;

    // Set only some vars.
    //
    // PDF_WORKER_SECRET is deleted rather than merely left out: the spread
    // below copies the developer's real environment, so a test that relies on
    // a key being ABSENT passes on a clean machine and fails on anyone who
    // exports it — which is exactly how this failed locally while green in CI.
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test@localhost/db',
      DATABASE_READONLY_URL: 'postgresql://readonly@localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      LLM_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
    };
    delete process.env.PDF_WORKER_SECRET;

    try {
      expect(() => {
        const envSchema = z.object({
          PDF_WORKER_SECRET: z.string().min(16),
        });
        envSchema.parse(process.env);
      }).toThrow();
    } finally {
      process.env = originalEnv;
    }
  });

  it('rejects a missing var even when the ambient environment defines it', () => {
    // Locks the fix above: this used to depend on the shell, not on the code.
    const originalEnv = process.env;
    process.env = { ...originalEnv, PDF_WORKER_SECRET: 'x'.repeat(32) };

    try {
      const parsed = z.object({ PDF_WORKER_SECRET: z.string().min(16) }).safeParse(
        Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key !== 'PDF_WORKER_SECRET'),
        ),
      );
      expect(parsed.success).toBe(false);
    } finally {
      process.env = originalEnv;
    }
  });

  it('rejects short LLM_KEY_ENCRYPTION_KEY', () => {
    expect(() =>
      z.string().regex(/^[a-f0-9]{64}$/i).parse('tooshort'),
    ).toThrow();
  });

  it('rejects non-URL DATABASE_URL', () => {
    expect(() => z.string().url().parse('not-a-url')).toThrow();
  });
});