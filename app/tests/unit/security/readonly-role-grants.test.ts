import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `dashbi_readonly` exists to read the per-org upload tables that live in
 * the `org_<uuid>` schemas (migration 0018 grants those). It has no
 * business reading dash-bi's own tenant tables in `public`: if it cannot
 * read them, a SQL injection in user-supplied query text cannot exfiltrate
 * them even if it manages to re-point the `app.current_org_id` GUC.
 *
 * Migration 0017 already revoked SELECT on ten internal tables
 * (auth/session/config tables). These nine were still missing:
 */
const INTERNAL_TABLES = [
  'dashboards',
  'dashboard_versions',
  'llm_usage',
  'nlqa_conversations',
  'nlqa_messages',
  'scheduled_reports',
  'scheduled_report_runs',
  'alert_events',
  'uploaded_files',
];

const APP_ROOT = resolve(__dirname, '../../..');
const MIGRATION_PATH = resolve(
  APP_ROOT,
  'drizzle/migrations/0019_readonly_revoke_internal_tables.sql',
);
const JOURNAL_PATH = resolve(APP_ROOT, 'drizzle/migrations/meta/_journal.json');

/**
 * Read inside the tests, not at module scope: a missing migration must
 * fail the assertions one by one, not blow up the whole file at import
 * time.
 */
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

describe('dashbi_readonly — revoked from the internal tenant tables', () => {
  it('is registered in the migration journal as idx 19', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
    };

    const entry = journal.entries.find((e) => e.idx === 19);
    expect(entry?.tag).toBe('0019_readonly_revoke_internal_tables');
    expect(entry?.version).toBe('7');
    expect(entry?.breakpoints).toBe(true);
    expect(typeof entry?.when).toBe('number');
  });

  it('is the last entry of the journal', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    const last = journal.entries[journal.entries.length - 1];
    expect(last?.idx).toBe(19);
    expect(last?.tag).toBe('0019_readonly_revoke_internal_tables');
  });

  it.each(INTERNAL_TABLES)('revokes the privilege on %s from dashbi_readonly', (table) => {
    expect(readMigration()).toContain(`'${table}'`);
  });

  it('revokes exactly the nine internal tables — no more, no less', () => {
    const arrayMatch = readMigrationCode().match(/IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]/);
    expect(arrayMatch).not.toBeNull();

    const tableNames = [...(arrayMatch?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(tableNames)).toEqual(new Set(INTERNAL_TABLES));
  });

  it('revokes on the public schema, from the read-only role', () => {
    expect(readMigrationCode()).toMatch(
      /REVOKE\s+(ALL|SELECT)\s+ON TABLE public\.%I FROM dashbi_readonly/,
    );
  });

  it('is idempotent: it skips cleanly when the role does not exist', () => {
    expect(readMigrationCode()).toMatch(/rolname = 'dashbi_readonly'/);
  });

  it('skips tables that do not exist in this installation', () => {
    expect(readMigrationCode()).toMatch(/pg_tables|to_regclass/);
  });

  it('grants nothing and does not touch the per-org schemas', () => {
    const code = readMigrationCode();
    expect(code).not.toMatch(/GRANT/i);
    expect(code).not.toMatch(/org_/);
  });

  it('documents why the revocation exists', () => {
    const migration = readMigration();
    expect(migration).toMatch(/dashbi_readonly/);
    expect(migration).toMatch(/0018/);
  });
});

/**
 * A DEFAULT PRIVILEGE hands the read-only role SELECT on every table
 * created in `public` from that point on — including the next internal
 * table, which no migration would have revoked yet. The bootstrap used to
 * grant it, so the revocation above would have been undone by the next
 * release.
 */
describe('dashbi_readonly — no default privilege over the public schema', () => {
  it('the migration revokes the default privilege', () => {
    expect(readMigrationCode()).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public\s+REVOKE SELECT ON TABLES FROM dashbi_readonly/,
    );
  });

  it('the bootstrap does not grant the default privilege to the read-only role', () => {
    const bootstrap = readFileSync(resolve(APP_ROOT, '../scripts/postgres/init-roles.sh'), 'utf8');

    // Every ALTER DEFAULT PRIVILEGES in the bootstrap must belong to the
    // app role, never to the read-only role.
    const defaultPrivilegeBlocks = bootstrap.match(
      /ALTER DEFAULT PRIVILEGES[\s\S]*?(?=EOSQL|psql_run|^\s*$)/gm,
    );
    expect(defaultPrivilegeBlocks).not.toBeNull();

    for (const block of defaultPrivilegeBlocks ?? []) {
      expect(block).not.toMatch(/readonly_user/);
    }
  });

  it('the test bootstrap does not grant it either', () => {
    const testBootstrap = readFileSync(
      resolve(APP_ROOT, 'tests/integration/postgres.ts'),
      'utf8',
    );

    const defaultPrivilegeStatements = testBootstrap.match(
      /ALTER DEFAULT PRIVILEGES[\s\S]*?;/g,
    );
    for (const statement of defaultPrivilegeStatements ?? []) {
      expect(statement).not.toMatch(/dashbi_readonly/);
    }
  });
});
