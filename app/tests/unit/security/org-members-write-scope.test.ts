import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `org_members` is the table that decides WHICH TENANTS A USER BELONGS TO.
 * Every other isolation guarantee in the app is downstream of it: `orgs_isolation`
 * derives "which orgs can this user see" from this table, and the members
 * list of an org is this table.
 *
 * That makes its `WITH CHECK` a security boundary, and the one migration 0017
 * wrote had a hole in it:
 *
 *   WITH CHECK (user_id = current_user_id OR org_id = app_current_org_id())
 *
 * The first branch is satisfied by any row that is ABOUT the caller — and a
 * row about the caller can name a DIFFERENT org. So a user could insert
 * `(user_id = me, org_id = <another tenant>)` and, because the org switcher
 * reads memberships, become a member of that tenant with the role of their
 * choosing.
 *
 * The reads keep both branches on purpose: a user has to see their own
 * memberships (the switcher needs all of them, not just the active one) and
 * the members of the org they are in (the members list).
 *
 * These assertions are on the MIGRATION TEXT, so the guarantee is locked
 * even in a run with no container runtime — the behavioural proof lives in
 * `app/tests/integration/rls-isolation.test.ts`.
 */
const APP_ROOT = resolve(__dirname, '../../..');
const MIGRATION_PATH = resolve(
  APP_ROOT,
  'drizzle/migrations/0020_org_members_write_scope.sql',
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

/** The text of the `WITH CHECK (...)` of the policy. */
function withCheckClause(): string {
  const match = readMigrationCode().match(/WITH CHECK\s*\(([\s\S]*?)\);/);
  expect(match, 'la migración debe definir un WITH CHECK').not.toBeNull();
  return match?.[1] ?? '';
}

/** The text of the `USING (...)` of the policy. */
function usingClause(): string {
  const match = readMigrationCode().match(/USING\s*\(([\s\S]*?)\)\s*\n\s*WITH CHECK/);
  expect(match, 'la migración debe definir un USING').not.toBeNull();
  return match?.[1] ?? '';
}

describe('org_members — la escritura queda dentro de la org activa', () => {
  it('is registered in the migration journal as idx 20', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
    };

    const entry = journal.entries.find((e) => e.idx === 20);
    expect(entry?.tag).toBe('0020_org_members_write_scope');
    expect(entry?.version).toBe('7');
    expect(entry?.breakpoints).toBe(true);
    expect(typeof entry?.when).toBe('number');
  });

  it('the journal entries are contiguous and in order', () => {
    // "0020 is the last entry" was true for one instant: the next
    // migration stops it from being. What does not depend on the instant
    // is that the idx form a gapless sequence — a gap means the migrator
    // skips an entry, and the migration after it never runs.
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries.map((e) => e.idx)).toEqual(
      journal.entries.map((_, i) => i),
    );
  });

  it('recreates the policy instead of adding a second one', () => {
    const code = readMigrationCode();
    expect(code).toMatch(/DROP POLICY IF EXISTS "org_members_isolation" ON "org_members"/);
    expect(code).toMatch(/CREATE POLICY "org_members_isolation" ON "org_members"/);
  });

  it('scopes the WRITE to the active org', () => {
    // La fila que se escribe tiene que ser de la org activa. Nada más.
    expect(withCheckClause()).toMatch(/org_id\s*=\s*app_current_org_id\(\)/);
  });

  it('does NOT let a row about the caller decide the write', () => {
    // Esta es la rama del agujero: `user_id = current_user_id` en el
    // WITH CHECK deja pasar cualquier fila about the caller, con la org que
    // quiera.
    expect(withCheckClause()).not.toMatch(/user_id/);
  });

  it('keeps BOTH branches on the READ: own memberships AND the members of the active org', () => {
    const using = usingClause();

    // `user_id = current_user_id`: el switcher de orgs tiene que ver TODAS
    // las membresías del usuario, no solo la de la org activa.
    expect(using).toMatch(/user_id/);

    // `org_id = app_current_org_id()`: el listado de miembros de la org.
    expect(using).toMatch(/org_id\s*=\s*app_current_org_id\(\)/);
  });

  it('is idempotent: dropping the policy first makes a re-run harmless', () => {
    expect(readMigrationCode()).toMatch(/DROP POLICY IF EXISTS/);
  });

  it('touches nothing but org_members', () => {
    const code = readMigrationCode();

    // Una migración de policy que además abre permisos es una migración que
    // no se puede revisar de un vistazo.
    expect(code).not.toMatch(/GRANT/i);
    expect(code).not.toMatch(/REVOKE/i);
    expect(code).not.toMatch(/ALTER\s+TABLE\s+(?!org_members)/i);
  });

  it('documents the hole it closes', () => {
    const migration = readMigration();

    // La razón del cambio tiene que quedar en el archivo: la próxima
    // persona que lea la policy tiene que entender por qué es así.
    expect(migration).toMatch(/0017/);
    expect(migration).toMatch(/user_id/);
  });
});

/**
 * The policy and the code are one contract.
 *
 * `provisionOrgForUser` writes the FIRST membership of a brand-new org, and
 * the policy of migration 0020 only lets a membership be written inside the
 * ACTIVE org. That works because the provisioning scopes the session to the
 * org it is creating — and if that ever stops being true, the signup breaks
 * in a way that only shows up in production.
 */
describe('provisionOrgForUser — la org que se crea es la org activa', () => {
  const CONFIG_PATH = resolve(APP_ROOT, 'src/lib/auth/config.ts');

  function configSource(): string {
    return readFileSync(CONFIG_PATH, 'utf8');
  }

  it('scopes the session to the org it is about to create', () => {
    expect(configSource()).toMatch(
      /set_config\('app\.current_org_id',\s*\$\{orgId\}/,
    );
  });

  it('sets that GUC BEFORE it writes the membership row', () => {
    const source = configSource();
    const gucIndex = source.indexOf("set_config('app.current_org_id'");
    const insertIndex = source.indexOf('insert(orgMembers)');

    expect(gucIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(-1);
    expect(gucIndex).toBeLessThan(insertIndex);
  });

  it('writes the membership of the org it just created', () => {
    // `insert(orgMembers).values({ orgId, ... })`: la fila es de la MISMA org
    // que la que se acaba de crear, no de otra.
    const source = configSource();
    const insertIndex = source.indexOf('insert(orgMembers)');
    const block = source.slice(insertIndex, insertIndex + 200);

    expect(block).toMatch(/orgId/);
  });
});
