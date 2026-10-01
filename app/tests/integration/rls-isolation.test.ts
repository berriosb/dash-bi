import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  getTestDb,
  resetDb,
  closeTestDb,
  type TestDb,
} from './postgres';
import { schemaRef } from './postgres';

/**
 * Sprint 1.5 — T1 (Cross-tenant data leak) integration tests.
 *
 * Run against a real Postgres 16 instance via Testcontainers with the
 * full migration set applied. The container's superuser owns the tables
 * but RLS is verified via `SET ROLE dashbi` to a non-superuser that we
 * create during setup. This locks down the failure mode where a callback
 * forgets to use `tx` and a query bypasses the GUCs.
 *
 * Requires Docker. Without a container runtime these tests SKIP with a
 * warning rather than failing the whole unit run — a hard failure here
 * taught everyone to ignore red. Set `RLS_TESTS_REQUIRED=1` to turn a
 * missing runtime into a hard error; CI sets it so the tenant-isolation
 * guarantee can never be silently skipped on the merge gate.
 */
const RUNTIME_UNAVAILABLE = /container runtime|Could not find a working container runtime/i;

async function setRoleAndGucs(
  tx: TestDb,
  orgId: string | null,
  userId: string | null,
  role: 'admin' | 'editor' | 'viewer',
): Promise<void> {
  // `set_config(name, value, is_local=true)` mirrors what withOrgContext
  // does in production. SET LOCAL ROLE switches the session to the
  // non-superuser `dashbi` so FORCE RLS applies.
  await tx.execute(sql.raw("SET LOCAL ROLE dashbi"));
  if (orgId === null) {
    await tx.execute(
      sql`SELECT set_config('app.current_org_id', NULL, true)`,
    );
  } else {
    await tx.execute(
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
    );
  }
  if (userId === null) {
    await tx.execute(
      sql`SELECT set_config('app.current_user_id', NULL, true)`,
    );
  } else {
    await tx.execute(
      sql`SELECT set_config('app.current_user_id', ${userId}, true)`,
    );
  }
  await tx.execute(
    sql`SELECT set_config('app.current_user_role', ${role}, true)`,
  );
}

describe('T1 — Cross-tenant isolation (Postgres RLS, real DB)', () => {
  let db: TestDb;
  let runtimeAvailable = true;

  beforeAll(async () => {
    try {
      db = await getTestDb();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!RUNTIME_UNAVAILABLE.test(message)) throw error;

      // Never let CI lose this coverage silently: RLS_TESTS_REQUIRED=1
      // turns a missing runtime into a hard failure of the merge gate.
      if (process.env.RLS_TESTS_REQUIRED === '1') {
        throw new Error(
          'RLS integration tests are required but no container runtime is available: ' +
            message,
          { cause: error },
        );
      }
      runtimeAvailable = false;
      console.warn(
        '\n[SKIP] T1 RLS integration tests need Docker (Testcontainers). ' +
          'The multi-tenant isolation guarantee is UNVERIFIED in this run.\n',
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

  // Vitest 3 only exposes `ctx.skip()` inside a test body, not in
  // `beforeAll`, so the availability flag is checked per test.
  function itWithDb(name: string, fn: () => Promise<void>): void {
    it(name, async (ctx) => {
      if (!runtimeAvailable || !db) {
        ctx.skip();
        return;
      }
      await fn();
    });
  }

  itWithDb('reproduces the failure mode: db.select() without GUC returns zero rows for tenant tables', async () => {
    const { users, orgs, orgMembers } = schemaRef();

    const [adminUser] = await db.insert(users).values({
      email: 'admin@org-a.test',
      name: 'Admin A',
    }).returning();
    if (!adminUser) throw new Error('seed: adminUser missing');
    const [memberUser] = await db.insert(users).values({
      email: 'user@org-a.test',
      name: 'User A',
    }).returning();
    if (!memberUser) throw new Error('seed: memberUser missing');

    const [org] = await db.insert(orgs).values({
      name: 'Org A',
      slug: 'org-a',
    }).returning();
    if (!org) throw new Error('seed: org missing');

    await db.insert(orgMembers).values({
      orgId: org.id,
      userId: adminUser.id,
      role: 'admin',
      joinedAt: new Date(),
    });
    await db.insert(orgMembers).values({
      orgId: org.id,
      userId: memberUser.id,
      role: 'editor',
      joinedAt: new Date(),
    });

    // Run as a non-superuser so FORCE RLS applies.
    const visibleToAnyone = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, null, null, 'viewer');
      return tx.select().from(orgMembers);
    });
    expect(visibleToAnyone).toEqual([]);
  });

  itWithDb('withOrgContext(orgId, userId, fn) isolates per tenant', async () => {
    const { users, orgs, orgMembers, dashboards } = schemaRef();

    const [orgA, orgB] = await db.insert(orgs).values([
      { name: 'Org A', slug: 'org-a' },
      { name: 'Org B', slug: 'org-b' },
    ]).returning();
    if (!orgA || !orgB) throw new Error('seed: orgA/orgB missing');

    const [userA, userB] = await db.insert(users).values([
      { email: 'a@a.test', name: 'User A' },
      { email: 'b@b.test', name: 'User B' },
    ]).returning();
    if (!userA || !userB) throw new Error('seed: userA/userB missing');

    await db.insert(orgMembers).values([
      { orgId: orgA.id, userId: userA.id, role: 'admin', joinedAt: new Date() },
      { orgId: orgB.id, userId: userB.id, role: 'admin', joinedAt: new Date() },
    ]);

    await db.insert(dashboards).values([
      { orgId: orgA.id, title: 'A secret', widgets: [], createdBy: userA.id, updatedBy: userA.id },
      { orgId: orgB.id, title: 'B secret', widgets: [], createdBy: userB.id, updatedBy: userB.id },
    ]);

    // Same-tenant: user A reads dashboards in org A.
    const orgAResult = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, orgA.id, userA.id, 'admin');
      return tx.select({ title: dashboards.title, orgId: dashboards.orgId }).from(dashboards);
    });

    const titles = orgAResult.map((r) => r.title).sort();
    expect(titles).toEqual(['A secret']);

    // Cross-tenant: user A (member of orgA) with orgA GUCs sees ONLY orgA.
    // NOTE: the current `dashboards_isolation` policy only checks
    // `org_id = GUC_org_id`, not user membership — i.e., RLS scopes by org
    // context, not by who the user is. Tightening the policy to also
    // require user membership (joins `org_members`) is the next hardening
    // step tracked in the threat-model follow-ups; the application layer
    // (requirePermission + tx) is what enforces membership today.
    // This assertion locks down the behavior the policy actually has.
    const crossTenant = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, orgA.id, userA.id, 'admin');
      return tx.select({ title: dashboards.title }).from(dashboards);
    });
    const crossTenantTitles = crossTenant.map((r) => r.title).sort();
    expect(crossTenantTitles).toEqual(['A secret']);
  });

  itWithDb('scheduled_reports and scheduled_report_runs are isolated per tenant (migration 0013)', async () => {
    const { users, orgs, orgMembers, dashboards, scheduledReports, scheduledReportRuns } = schemaRef();

    const [orgA, orgB] = await db.insert(orgs).values([
      { name: 'Org A', slug: 'rls-org-a' },
      { name: 'Org B', slug: 'rls-org-b' },
    ]).returning();
    if (!orgA || !orgB) throw new Error('seed: orgA/orgB missing');

    const [userA] = await db.insert(users).values({ email: 'rls-a@a.test', name: 'A' }).returning();
    if (!userA) throw new Error('seed: userA missing');
    await db.insert(orgMembers).values({
      orgId: orgA.id, userId: userA.id, role: 'admin', joinedAt: new Date(),
    });

    const [dashA, dashB] = await db.insert(dashboards).values([
      { orgId: orgA.id, title: 'A dash', widgets: [], createdBy: userA.id, updatedBy: userA.id },
      { orgId: orgB.id, title: 'B dash', widgets: [], createdBy: userA.id, updatedBy: userA.id },
    ]).returning();
    if (!dashA || !dashB) throw new Error('seed: dashboards missing');

    const [reportA, reportB] = await db.insert(scheduledReports).values([
      {
        orgId: orgA.id, dashboardId: dashA.id, createdBy: userA.id, cron: '0 9 * * 1',
        timezone: 'UTC', format: 'pdf', includeBranding: false,
        recipients: [{ email: 'cfo@org-a.test' }], enabled: true,
        nextRunAt: new Date('2099-01-01T09:00:00Z'), title: 'A report',
      },
      {
        orgId: orgB.id, dashboardId: dashB.id, createdBy: userA.id, cron: '0 9 * * 1',
        timezone: 'UTC', format: 'pdf', includeBranding: false,
        recipients: [{ email: 'cfo@org-b.test' }], enabled: true,
        nextRunAt: new Date('2099-01-01T09:00:00Z'), title: 'B report',
      },
    ]).returning();
    if (!reportA || !reportB) throw new Error('seed: reports missing');

    await db.insert(scheduledReportRuns).values({
      orgId: orgA.id,
      scheduledReportId: reportA.id,
      status: 'success',
      startedAt: new Date('2099-01-01T09:00:00Z'),
    });

    // Org A context sees only org A's report…
    const asOrgA = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, orgA.id, userA.id, 'admin');
      return tx.select({ title: scheduledReports.title }).from(scheduledReports);
    });
    expect(asOrgA.map((r) => r.title)).toEqual(['A report']);

    // …and only org A's run.
    const runsAsOrgA = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, orgA.id, userA.id, 'admin');
      return tx.select({ id: scheduledReportRuns.id }).from(scheduledReportRuns);
    });
    expect(runsAsOrgA).toHaveLength(1);

    // No GUCs → the tables are invisible, which is the whole point of the
    // backstop: a query that forgets `withOrgContext` returns nothing rather
    // than every tenant's recipients.
    const withoutGucs = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, null, null, 'viewer');
      return tx.select({ title: scheduledReports.title }).from(scheduledReports);
    });
    expect(withoutGucs).toEqual([]);

    // An INSERT that claims another org is rejected by the WITH CHECK policy.
    await expect(
      db.transaction(async (tx) => {
        await setRoleAndGucs(tx, orgA.id, userA.id, 'admin');
        await tx.insert(scheduledReports).values({
          orgId: orgB.id, dashboardId: dashB.id, createdBy: userA.id, cron: '0 9 * * 1',
          timezone: 'UTC', format: 'pdf', includeBranding: false,
          recipients: [{ email: 'attacker@evil.test' }], enabled: true,
          nextRunAt: new Date('2099-01-01T09:00:00Z'), title: 'Cross-org write',
        });
      }),
    ).rejects.toThrow();
  });

  itWithDb('requiresPermission finds membership only when same-org GUCs are set', async () => {
    const { users, orgs, orgMembers } = schemaRef();

    const [orgA] = await db.insert(orgs).values({ name: 'Org A', slug: 'org-a' }).returning();
    if (!orgA) throw new Error('seed: orgA missing');
    const [userA] = await db.insert(users).values({ email: 'a@a.test', name: 'A' }).returning();
    if (!userA) throw new Error('seed: userA missing');
    await db.insert(orgMembers).values({
      orgId: orgA.id, userId: userA.id, role: 'admin', joinedAt: new Date(),
    });

    // No GUCs → RLS blocks visibility of the membership row.
    const noMembership = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, null, null, 'viewer');
      return tx.query.orgMembers.findFirst({
        where: and(eq(schemaRef().orgMembers.userId, userA.id), eq(schemaRef().orgMembers.orgId, orgA.id)),
      });
    });
    expect(noMembership).toBeUndefined();

    // With GUCs in the same transaction → membership is visible.
    const txVisible = await db.transaction(async (tx) => {
      await setRoleAndGucs(tx, orgA.id, userA.id, 'admin');
      return tx.query.orgMembers.findFirst({
        where: and(eq(schemaRef().orgMembers.userId, userA.id), eq(schemaRef().orgMembers.orgId, orgA.id)),
      });
    });
    expect(txVisible?.orgId).toBe(orgA.id);
  });
});