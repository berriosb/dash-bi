import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetDb, closeTestDb, type TestDb } from './postgres';

/**
 * Migration 0014 — the SECURITY DEFINER functions that replaced
 * `withSystemContext()`.
 *
 * The functions exist to do the one thing a request handler should not: cross
 * orgs, on behalf of a platform worker or an unguessable public token. They
 * run with the owner's privileges, so the security properties below are the
 * whole ballgame — a SECURITY DEFINER function that PUBLIC can call is an RLS
 * bypass with a nicer name.
 *
 * Requires Docker; skips (rather than fails) without a container runtime,
 * unless RLS_TESTS_REQUIRED=1.
 */
const RUNTIME_UNAVAILABLE = /container runtime|Could not find a working container runtime/i;

const SYSTEM_FUNCTIONS = [
  'dashbi_due_alert_rules',
  'dashbi_count_enabled_alert_rules',
  'dashbi_load_alert_rule',
  'dashbi_resolve_public_link',
  // From migration 0015. Both cross the RLS boundary on purpose, which is why
  // they are on this list and not just in their own suite: a SECURITY DEFINER
  // function that PUBLIC can call is an RLS bypass with a nicer name, and the
  // whole point of this allowlist is that adding one is a decision somebody
  // made out loud.
  //
  //   dashbi_user_belongs_to_org — the `orgs` read/update policy. It has to
  //     read `org_members`, which has its own RLS; querying it inline is
  //     rejected as `infinite recursion detected in policy`. Returns one
  //     boolean per row, so the leak is a membership answer about an org the
  //     caller already named — not the org list.
  //
  //   dashbi_slug_is_taken — slug uniqueness is a GLOBAL constraint, not a
  //     per-tenant one, so the probe has to see every org including the ones
  //     the provisioning user belongs to (none). Returns one boolean per
  //     candidate slug: an existence oracle over a user-chosen string, which
  //     is the minimum this needs to answer.
  'dashbi_user_belongs_to_org',
  'dashbi_slug_is_taken',
];

describe('SECURITY DEFINER system functions', () => {
  let db: TestDb;
  let runtimeAvailable = false;

  beforeAll(async () => {
    try {
      db = await getTestDb();
      runtimeAvailable = true;
    } catch (error) {
      if (RUNTIME_UNAVAILABLE.test(String(error))) {
        if (process.env.RLS_TESTS_REQUIRED === '1') throw error;
        console.warn('[integration] skipped: no container runtime for Postgres');
        return;
      }
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    if (db) await closeTestDb();
  });

  beforeEach(async () => {
    if (db) await resetDb();
  }, 60_000);

  /**
   * Vitest only exposes `ctx.skip()` inside a test body, so availability is
   * checked per test rather than once in `beforeAll`.
   *
   * This matters: without it a missing container runtime makes the assertions
   * `return` early and report PASSED, which is a green suite that verified
   * nothing. Same helper the rls-isolation suite uses.
   */
  function itWithDb(name: string, fn: () => Promise<void>): void {
    it(name, async (ctx) => {
      if (!runtimeAvailable || !db) {
        ctx.skip();
        return;
      }
      await fn();
    });
  }

  itWithDb('exist and are SECURITY DEFINER with a pinned search_path', async () => {
    const rows = await db.execute<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(sql`
      SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'dashbi\_%'
    `);
    const found = rows.map((r) => r.proname as string).sort();
    expect(found).toEqual([...SYSTEM_FUNCTIONS].sort());
    for (const row of rows) {
      expect(row.prosecdef, `${row.proname} must be SECURITY DEFINER`).toBe(true);
      // An unpinned search_path lets anyone with CREATE on public hijack the
      // function's name resolution and run it as the owner.
      const searchPath = (row.proconfig ?? []).find((c) => c.startsWith('search_path='));
      expect(
        searchPath,
        `${row.proname} has no pinned search_path`,
      ).toMatch(/^search_path=pg_catalog,\s*public$/);
    }
  });

  itWithDb('are NOT executable by PUBLIC, and not by the AI read-only role', async () => {
    const rows = await db.execute<{ proname: string; public_execute: boolean; ro_execute: boolean }>(sql`
      SELECT p.proname,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
             has_function_privilege('dashbi_readonly', p.oid, 'EXECUTE') AS ro_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'dashbi\_%'
    `);
    expect(rows.length).toBe(SYSTEM_FUNCTIONS.length);
    for (const row of rows) {
      expect(
        row.public_execute,
        `${row.proname} is callable by PUBLIC — that is an RLS bypass`,
      ).toBe(false);
      expect(
        row.ro_execute,
        `${row.proname} is callable by dashbi_readonly, the role AI-written SQL uses`,
      ).toBe(false);
    }
  });

  itWithDb('cross orgs for a non-superuser where RLS would otherwise hide everything', async () => {
    // Two orgs, one alert rule each. The dispatcher has to see both, and it
    // runs as the app role, which RLS would otherwise reduce to zero rows.
    await db.execute(sql`
      INSERT INTO orgs (id, name, slug, created_at, updated_at) VALUES
        ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a', now(), now()),
        ('22222222-2222-2222-2222-222222222222', 'Org B', 'org-b', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO users (id, name, email, created_at, updated_at)
      VALUES ('33333333-3333-3333-3333-333333333333', 'u', 'u@x.invalid', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO dashboards (id, org_id, created_by, title, created_at, updated_at) VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'A', now(), now()),
        ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'B', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO alert_rules (id, org_id, dashboard_id, created_by, name, query_sql, query_columns, condition, channels, evaluation_interval_minutes)
      VALUES
        ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'r1', 'SELECT 1', '[]', '{}', '[]', 5),
        ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'r2', 'SELECT 1', '[]', '{}', '[]', 5)
    `);

    // Baseline: as the non-superuser app role with no GUC, RLS hides
    // everything. This is what withSystemContext used to look like.
    const blind = await db.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE dashbi'));
      return tx.execute(sql`SELECT count(*)::int AS n FROM alert_rules`);
    });
    expect((blind[0] as { n: number }).n).toBe(0);

    // Through the function: both tenants' rules.
    const viaFunction = await db.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE dashbi'));
      return tx.execute(sql`SELECT id FROM dashbi_due_alert_rules()`);
    });
    expect(viaFunction.length).toBe(2);
  });

  itWithDb('resolves a public link by token and returns the owning org', async () => {
    await db.execute(sql`
      INSERT INTO orgs (id, name, slug, created_at, updated_at)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO users (id, name, email, created_at, updated_at)
      VALUES ('33333333-3333-3333-3333-333333333333', 'u', 'u@x.invalid', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO dashboards (id, org_id, created_by, title, created_at, updated_at)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'A', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO public_links (id, org_id, dashboard_id, created_by, token)
      VALUES ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'tok-abc')
    `);

    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE dashbi'));
      return tx.execute(sql`SELECT * FROM dashbi_resolve_public_link('tok-abc')`);
    });
    expect(rows.length).toBe(1);
    expect((rows[0] as { org_id: string }).org_id).toBe('11111111-1111-1111-1111-111111111111');

    // An unknown token resolves to nothing rather than erroring or leaking.
    const missing = await db.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE dashbi'));
      return tx.execute(sql`SELECT * FROM dashbi_resolve_public_link('nope')`);
    });
    expect(missing.length).toBe(0);
  });
});
