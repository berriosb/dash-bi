import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T7 cleanup — no hardcoded Postgres credentials in the repository.
 *
 * `scripts/postgres/init-readonly.sql` carried
 * `CREATE ROLE dashbi_readonly WITH LOGIN PASSWORD 'dashbi_readonly_password'`
 * in the repo, and no compose file mounted it any more, so it sat there looking
 * authoritative while granting nothing. It is deleted, along with its
 * incompatible twin under `app/`.
 *
 * This guard exists so the next person who writes a bootstrap script does not
 * reintroduce the same thing. The one legitimate literal Postgres password is
 * the CI workflow, which provisions an ephemeral container; that file is named
 * explicitly rather than allowed by pattern, because a pattern broad enough to
 * permit it would also permit the real thing.
 */

/** Ephemeral CI container, no published port. See .github/workflows/ci.yml. */
const ALLOWED_FILES = new Set(['.github/workflows/ci.yml']);

/** Fixtures and docs that legitimately show placeholder credentials. */
const ALLOWED_VALUES = new Set([
  '__PASTE_HERE__',
  '__REQUIRED__',
  'changeme',
  're_mock_key',
  'dashbi', // harness role password in tests/integration/postgres.ts
]);

/**
 * Matches only real credential LITERALS, never field names.
 *
 * The first attempt at this guard used `\bpassword\b\s*[:=]` and returned 56
 * false positives: `password: string;` in a connector, `password: z.string()
 * .min(8)` in a zod schema, `text('password')` in the Drizzle schema. A guard
 * that cries wolf gets deleted, and then the real one is gone too.
 *
 * So the pattern is anchored to the forms a secret actually takes: a quoted
 * literal in SQL, or an env-var assignment in shell/YAML. TypeScript is not
 * scanned at all — there, `password` is overwhelmingly a field name.
 */
const CREDENTIAL = [
  /\bPASSWORD\s+'([^']{3,})'/g, // SQL:  PASSWORD 'literal'
  /\bPGPASSWORD\s*[:=]\s*['"]?([^\s'"$}{]{3,})/g, // shell/YAML: PGPASSWORD=x
];

/** Files where a literal can actually mean a stored secret. */
const SCANNED = /\.(sql|sh|ya?ml)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next']);

function repoFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      repoFiles(full, out);
    } else if (SCANNED.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('T7 guard: no hardcoded Postgres credentials', () => {
  // Vitest runs with cwd = app/, so the repo root is one level up.
  const repoRoot = join(process.cwd(), '..');
  const files = repoFiles(repoRoot);

  it('scans a non-trivial number of files', () => {
    // Only .sql/.sh/.yml are scanned (see CREDENTIAL), so this is well under
    // the repo's total. The floor exists to catch the scanner silently
    // matching nothing, which is the failure mode a regex-based guard has.
    expect(files.length).toBeGreaterThan(25);
  });

  it('finds no literal database password outside the allowlist', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(repoRoot.length + 1);
      if (ALLOWED_FILES.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      for (const pattern of CREDENTIAL) {
        for (const match of source.matchAll(pattern)) {
          const value = match[1] ?? '';
          if (ALLOWED_VALUES.has(value)) continue;
          offenders.push(`${rel}: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the production role bootstrap free of literals', () => {
    // The one script that runs in production takes every secret from the
    // environment. `set -euo pipefail` plus the `:?` guards below are what turn
    // a missing variable into a startup failure instead of an empty password.
    const source = readFileSync(join(repoRoot, 'scripts/postgres/init-roles.sh'), 'utf8');
    expect(source).not.toMatch(/PASSWORD\s+'[^']+'/);
    expect(source).toContain('set -euo pipefail');
    for (const required of [
      'POSTGRES_DB:?',
      'POSTGRES_APP_USER:?',
      'POSTGRES_APP_PASSWORD:?',
      'POSTGRES_READONLY_PASSWORD:?',
    ]) {
      expect(source).toContain(required);
    }
  });

  it('has no init-readonly.sql left to drift out of sync', () => {
    // There were two, with contradictory definitions of the same role. The
    // guard above is about credentials; this one is about the class of bug
    // that produced them.
    expect(repoFiles(repoRoot).filter((f) => f.endsWith('init-readonly.sql'))).toEqual([]);
  });
});
