import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// tests/unit/scripts/*.test.ts → app/tests/unit/scripts → app → <repo>
const REPO_ROOT = resolve(__dirname, '../../../..');
const COMPOSE = resolve(REPO_ROOT, 'docker-compose.yml');

// Env-var names that must NEVER have a fallback default in the root
// (production) compose file. A `${VAR:-default}` for any of these is a
// footgun: an operator who forgets to set `.env.staging` boots the stack
// with a publicly-known password and the smoke gate silently passes.
const FORBIDDEN_DEFAULT_VARS = [
  'POSTGRES_PASSWORD',
  'POSTGRES_READONLY_PASSWORD',
  'REDIS_PASSWORD',
  'LLM_KEY_ENCRYPTION_KEY',
  'BETTER_AUTH_SECRET',
  'PDF_WORKER_SECRET',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_SECRET',
];

// Explicit patterns that must never appear, regardless of variable name.
const FORBIDDEN_LITERALS = [
  'dashbi_password',
  'dashbi_readonly_password',
  'redis_password',
  // The 64-char hex blob that was being used as a default for the BYOK
  // master key. Anyone who reads the public repo has this value.
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'resend_dummy',
];

describe('docker-compose.yml (root, production topology)', () => {
  let source: string;

  beforeAll(() => {
    if (!existsSync(COMPOSE)) {
      throw new Error(`Missing root compose file: ${COMPOSE}`);
    }
    source = readFileSync(COMPOSE, 'utf8');
  });

  it('exists', () => {
    expect(existsSync(COMPOSE)).toBe(true);
  });

  it.each(FORBIDDEN_DEFAULT_VARS)(
    'has no insecure default fallback for %s (must use `?VAR` instead of `:-VAR`)',
    (envVar) => {
      // `${POSTGRES_PASSWORD:-anything}` → forbidden
      const re = new RegExp(`\\$\\{\\s*${envVar}\\s*:-\\s*([^}\\s]+)\\s*\\}`);
      expect(source).not.toMatch(re);
    },
  );

  it.each(FORBIDDEN_LITERALS)(
    'does not embed the known-bad default literal "%s"',
    (literal) => {
      expect(source).not.toContain(literal);
    },
  );

  it('uses `${VAR:?message}` syntax for all the secrets the smoke script enforces', () => {
    // The smoke-staging.sh script requires these 6 secrets. The compose
    // file MUST refuse to start without them, mirroring that gate at
    // the deploy level.
    for (const envVar of [
      'POSTGRES_PASSWORD',
      'POSTGRES_READONLY_PASSWORD',
      'REDIS_PASSWORD',
      'LLM_KEY_ENCRYPTION_KEY',
      'BETTER_AUTH_SECRET',
      'PDF_WORKER_SECRET',
    ]) {
      const re = new RegExp(`\\$\\{\\s*${envVar}\\s*:\\?`);
      expect(source, `expected \${${envVar}:?msg} somewhere in compose`).toMatch(re);
    }
  });
});