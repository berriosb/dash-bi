import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The ledger is a tenant-scoped table, so it has to be in the RLS
 * boundary like every other one: a reservation is an org's committed
 * budget, and another org's reservations are as much a leak as another
 * org's dashboards.
 *
 * These assertions are on the MIGRATION TEXT, so the guarantee is locked
 * even in a run with no container runtime — the behavioural proof lives
 * in `app/tests/integration/llm-budget-ledger.test.ts`.
 */
const APP_ROOT = resolve(__dirname, '../../..');
const MIGRATION_PATH = resolve(
  APP_ROOT,
  'drizzle/migrations/0021_llm_budget_reservations.sql',
);
const JOURNAL_PATH = resolve(APP_ROOT, 'drizzle/migrations/meta/_journal.json');

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

/** The migration body, with the Spanish `--` comments stripped. */
function readMigrationCode(): string {
  return readMigration()
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

describe('llm_budget_reservations — la tabla del ledger', () => {
  it('is registered in the migration journal as idx 21', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
    };

    const entry = journal.entries.find((e) => e.idx === 21);
    expect(entry?.tag).toBe('0021_llm_budget_reservations');
    expect(entry?.version).toBe('7');
    expect(entry?.breakpoints).toBe(true);
    expect(typeof entry?.when).toBe('number');
  });

  it('the journal entries are contiguous and in order', () => {
    // Which migration is the LAST one is a fact of the instant, not an
    // invariant: the next migration changes it. What has to hold is that
    // no idx is missing — a gap means the migrator skips an entry and
    // the migration after it never runs.
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ idx: number }>;
    };

    expect(journal.entries.map((e) => e.idx)).toEqual(
      journal.entries.map((_, i) => i),
    );
  });

  it('scopes the table to the tenant', () => {
    const code = readMigrationCode();

    expect(code).toMatch(/ALTER TABLE "llm_budget_reservations" ENABLE ROW LEVEL SECURITY/);
    // `FORCE` sin el cual la policy no aplica al dueño de la tabla, que
    // es como conecta la app.
    expect(code).toMatch(/ALTER TABLE "llm_budget_reservations" FORCE ROW LEVEL SECURITY/);
    expect(code).toMatch(/CREATE POLICY "llm_budget_reservations_isolation"/);
    expect(code).toMatch(/org_id = app_current_org_id\(\)/);
  });

  it('writes the reserved amount and settles it later', () => {
    const code = readMigrationCode();

    expect(code).toMatch(/"reserved_usd" text NOT NULL/);
    expect(code).toMatch(/"settled_usd" text/);
    expect(code).toMatch(/"status" text NOT NULL DEFAULT 'pending'/);
  });

  it('is not readable by the read-only role', () => {
    // `dashbi_readonly` existe para leer lo que el usuario tiene en sus
    // esquemas `org_<uuid>`, no el estado interno de dash-bi.
    expect(readMigrationCode()).toMatch(/REVOKE ALL ON TABLE public\.%I FROM dashbi_readonly/);
    expect(readMigration()).toMatch(/llm_budget_reservations/);
  });

  it('does not touch any other table', () => {
    const code = readMigrationCode();

    expect(code).not.toMatch(/ALTER TABLE "(?!llm_budget_reservations)/);
    expect(code).not.toMatch(/DROP TABLE/);
  });
});
