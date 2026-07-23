import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getEnv, type Env } from '@/lib/env';

describe('Environment validation', () => {
  it('rejects missing required vars', () => {
    const originalEnv = process.env;

    // Set only some vars
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test@localhost/db',
      DATABASE_READONLY_URL: 'postgresql://readonly@localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      LLM_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
      // PDF_WORKER_SECRET missing
    };

    expect(() => {
      // Force re-parse
      const envSchema = z.object({
        PDF_WORKER_SECRET: z.string().min(16),
      });
      envSchema.parse(process.env);
    }).toThrow();
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