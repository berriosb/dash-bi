import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// tests/unit/scripts/*.test.ts → app/tests/unit/scripts → app → <repo> (4 levels up)
const REPO_ROOT = resolve(__dirname, '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/smoke-staging.sh');

describe('scripts/smoke-staging.sh', () => {
  let source: string;

  beforeAll(() => {
    if (!existsSync(SCRIPT)) {
      throw new Error(
        `Missing required script: ${SCRIPT}. The staging smoke flow must be runnable as a single bash script.`,
      );
    }
    source = readFileSync(SCRIPT, 'utf8');
  });

  it('exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const st = statSync(SCRIPT);
    // owner-execute bit (0o100). Skip on Windows where the bit is meaningless.
    if (process.platform !== 'win32') {
      expect(st.mode & 0o100).not.toBe(0);
    }
  });

  it('starts with a bash shebang and strict mode', () => {
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(source).toMatch(/set -euo pipefail/);
  });

  it('targets the root docker-compose.yml (production topology)', () => {
    expect(source).toMatch(/docker compose(?:\s+-f\s+\S+)?\s+up/);
    // Should NOT point at app/docker-compose.yml (that's the dev topology).
    expect(source).not.toMatch(/app\/docker-compose\.yml/);
  });

  it('waits for /api/health before running e2e smoke', () => {
    expect(source).toMatch(/\/api\/health/);
    // Polling loop, not a one-shot curl
    expect(source).toMatch(/until|while\s+!?.*curl/i);
  });

  it('runs the @smoke Playwright spec against the running container', () => {
    expect(source).toMatch(/test:e2e:smoke/);
  });

  it('tears down the stack on failure (trap on EXIT)', () => {
    expect(source).toMatch(/trap\s+.*EXIT/);
    expect(source).toMatch(/down/);
  });

  it('refuses to run if required secrets are missing', () => {
    // The script must NOT have hardcoded fallback passwords like
    // `:-dashbi_password` — those are dev defaults that would leak into
    // a staging deploy. The hardened root compose uses `?VAR` instead.
    expect(source).not.toMatch(/:-dashbi_password/);
    expect(source).not.toMatch(/:-redis_password/);
  });
});