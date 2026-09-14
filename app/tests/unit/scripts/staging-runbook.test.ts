import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// tests/unit/scripts/*.test.ts → app/tests/unit/scripts → app → <repo>
const REPO_ROOT = resolve(__dirname, '../../../..');
const RUNBOOK = resolve(REPO_ROOT, 'docs/STAGING.md');

describe('docs/STAGING.md (staging runbook)', () => {
  let source: string;

  beforeAll(() => {
    if (!existsSync(RUNBOOK)) {
      throw new Error(
        `Missing required runbook: ${RUNBOOK}. A staging deploy without a runbook is a future incident.`,
      );
    }
    source = readFileSync(RUNBOOK, 'utf8');
  });

  it('exists', () => {
    expect(existsSync(RUNBOOK)).toBe(true);
  });

  it('is non-trivial (>= 100 lines, > 2KB)', () => {
    expect(source.split('\n').length).toBeGreaterThanOrEqual(100);
    expect(source.length).toBeGreaterThan(2048);
  });

  it('documents the secret-generation step with copy-pasteable openssl commands', () => {
    expect(source).toMatch(/openssl rand/);
    // Must mention every secret the smoke-staging script enforces.
    for (const secret of [
      'POSTGRES_PASSWORD',
      'POSTGRES_READONLY_PASSWORD',
      'REDIS_PASSWORD',
      'LLM_KEY_ENCRYPTION_KEY',
      'BETTER_AUTH_SECRET',
      'PDF_WORKER_SECRET',
    ]) {
      expect(source).toContain(secret);
    }
  });

  it('covers bootstrap, smoke, backups, restore, upgrade, rollback', () => {
    const required = [
      /bootstrap|first[- ]time|setup/i,
      /smoke[- ]staging\.sh|smoke/i,
      /backup/i,
      /restore/i,
      /upgrade|update/i,
      /rollback/i,
    ];
    for (const rx of required) {
      expect(source).toMatch(rx);
    }
  });

  it('references scripts/smoke-staging.sh as the canonical staging smoke command', () => {
    expect(source).toMatch(/scripts\/smoke-staging\.sh/);
  });

  it('does NOT leak real secrets (no placeholder passwords from the old README quickstart)', () => {
    // The README quickstart inherits `${POSTGRES_PASSWORD:-dashbi_password}` etc.
    // via the (currently insecure) root compose. The runbook MUST NOT repeat
    // those defaults — operators would copy them verbatim.
    expect(source).not.toMatch(/dashbi_password/);
    expect(source).not.toMatch(/redis_password/);
    expect(source).not.toMatch(/dashbi_readonly_password/);
  });
});