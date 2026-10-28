import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetDb, closeTestDb, type TestDb } from './postgres';
import { assertOrgContextIntact } from '@/db/org-context';

/**
 * The `set_config` pivot, against a real Postgres 16.
 *
 * `app.current_org_id` is a plain GUC and every tenant-scoped RLS policy
 * reads it through `app_current_org_id()`. This file proves, on a real
 * database, that:
 *
 *  1. a SINGLE statement can re-point the context and read another org's
 *     rows — the database offers no protection of its own;
 *  2. the guard (`db/org-context.ts`) DETECTS that, after the fact;
 *  3. the cleanup leaves the connection fail-closed ("no org") instead of
 *     poisoned with another tenant's id — a session-level setting survives
 *     the rollback.
 *
 * Requires Docker. Without a container runtime these tests SKIP with a
 * warning rather than failing the whole unit run; `RLS_TESTS_REQUIRED=1`
 * turns a missing runtime into a hard error (CI sets it).
 */
const RUNTIME_UNAVAILABLE = /container runtime|Could not find a working container runtime/i;

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

describe('Guard del contexto de tenant (Postgres real)', () => {
  let db: TestDb;
  let runtimeAvailable = true;

  beforeAll(async () => {
    try {
      db = await getTestDb();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!RUNTIME_UNAVAILABLE.test(message)) throw error;
      if (process.env.RLS_TESTS_REQUIRED === '1') {
        throw new Error(
          'RLS integration tests are required but no container runtime is available: ' +
            message,
          { cause: error },
        );
      }
      runtimeAvailable = false;
      console.warn(
        '\n[SKIP] Guard del contexto tests need Docker (Testcontainers). ' +
          'The pivot defense is UNVERIFIED in this run.\n',
      );
    }
  }, 120_000);

  beforeEach(async () => {
    if (!runtimeAvailable) return;
    await resetDb();
  }, 60_000);

  afterAll(async () => {
    if (!runtimeAvailable) return;
    await closeTestDb();
  });

  function itWithDb(name: string, fn: () => Promise<void>): void {
    it(name, async (ctx) => {
      if (!runtimeAvailable || !db) {
        ctx.skip();
        return;
      }
      await fn();
    });
  }

  /**
   * Two orgs, each with its own upload table protected by the same policy
   * the app creates (`buildRLSPoliciesSQL`): `org_id = app_current_org_id()`.
   */
  async function seedOrgTables(): Promise<void> {
    await db.execute(sql.raw(`
      CREATE SCHEMA IF NOT EXISTS org_probe_a;
      CREATE SCHEMA IF NOT EXISTS org_probe_b;
    `));
    for (const [schema, orgId, secret] of [
      ['org_probe_a', ORG_A, 'SECRET-ORG-A'],
      ['org_probe_b', ORG_B, 'SECRET-ORG-B'],
    ] as const) {
      await db.execute(sql.raw(`
        DROP TABLE IF EXISTS ${schema}.uploads CASCADE;
        CREATE TABLE ${schema}.uploads (
          _row_id BIGSERIAL PRIMARY KEY,
          org_id UUID NOT NULL,
          secret TEXT
        );
        ALTER TABLE ${schema}.uploads ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${schema}.uploads FORCE ROW LEVEL SECURITY;
        CREATE POLICY org_isolation_uploads ON ${schema}.uploads
          USING (org_id = app_current_org_id())
          WITH CHECK (org_id = app_current_org_id());
        INSERT INTO ${schema}.uploads (org_id, secret)
          VALUES ('${orgId}', '${secret}');
      `));
    }
    // The role that runs user-authored SQL has SELECT on every org schema
    // (migration 0018 + buildReadOnlyGrantsSQL).
    await db.execute(sql.raw(`
      GRANT USAGE ON SCHEMA org_probe_a, org_probe_b TO dashbi_readonly;
      GRANT SELECT ON ALL TABLES IN SCHEMA org_probe_a, org_probe_b TO dashbi_readonly;
    `));
  }

  itWithDb('una sola sentencia puede re-apuntar el contexto y leer otra org', async () => {
    await seedOrgTables();

    const leaked = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`);
      // La forma CTE: un SOLO statement, sin punto y coma.
      const rows = await tx.execute(sql.raw(`
        WITH x AS (
          SELECT set_config('app.current_org_id', '${ORG_B}', true) AS s
        )
        SELECT secret FROM org_probe_b.uploads, x
      `));
      return rows;
    });

    // Esto es lo que la base de datos permite: la fila de la otra org.
    expect(JSON.stringify(leaked)).toContain('SECRET-ORG-B');
  });

  itWithDb('el guard detecta el contexto re-apuntado', async () => {
    await seedOrgTables();

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`);
        await tx.execute(
          sql`SELECT set_config('app.current_user_id', NULL, true)`,
        );
        await tx.execute(sql`SELECT set_config('app.current_user_role', 'editor', true)`);

        // La sentencia del usuario re-apunta el contexto.
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_B}, true)`,
        );

        await assertOrgContextIntact(tx, {
          orgId: ORG_A,
          userId: null,
          role: 'editor',
        });
      }),
    ).rejects.toMatchObject({ code: 'tenant.cross_tenant_access' });
  });

  itWithDb('el guard pasa cuando el contexto sigue intacto', async () => {
    await seedOrgTables();

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_user_id', NULL, true)`);
      await tx.execute(sql`SELECT set_config('app.current_user_role', 'editor', true)`);

      await expect(
        assertOrgContextIntact(tx, {
          orgId: ORG_A,
          userId: null,
          role: 'editor',
        }),
      ).resolves.toBeUndefined();
    });
  });

  itWithDb('la limpieza deja la conexión fail-closed (sin org)', async () => {
    await seedOrgTables();

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`);
        await tx.execute(sql`SELECT set_config('app.current_user_id', NULL, true)`);
        await tx.execute(sql`SELECT set_config('app.current_user_role', 'editor', true)`);
        // Veneno a nivel de SESION: sobrevive al rollback.
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_B}, false)`);

        await assertOrgContextIntact(tx, {
          orgId: ORG_A,
          userId: null,
          role: 'editor',
        });
      }),
    ).rejects.toMatchObject({ code: 'tenant.cross_tenant_access' });

    // Fuera de la transacción: el valor de sesión quedó vacío, no con el org
    // de la otra tenant.
    const rows = await db.execute(
      sql`SELECT current_setting('app.current_org_id', true) AS org_id`,
    );
    const value = (rows[0] as { org_id?: string | null } | undefined)?.org_id;
    expect(value === '' || value === null).toBe(true);
  });
});
