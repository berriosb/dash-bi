import { sql, type SQL } from 'drizzle-orm';
import { AppErrorException } from '@/lib/errors/types';

/**
 * The guard that closes the `set_config` pivot.
 *
 * ## The hole it closes
 *
 * `app.current_org_id` is a plain PostgreSQL GUC, and EVERY tenant-scoped
 * RLS policy reads it through `app_current_org_id()`
 * (`app/drizzle/migrations/0004_rls_null_safe.sql`). A GUC is not a
 * security boundary: any role can set one for its own session, and the
 * role that runs user-authored SQL (`dashbi_readonly`) can do it too.
 *
 * Verified against a real Postgres 16:
 *
 * - `WITH x AS (SELECT set_config('app.current_org_id', '<other org>', true))
 *    SELECT * FROM other_org.uploads` returns ANOTHER org's rows — in a
 *    SINGLE statement.
 * - The session-level form (`set_config(..., false)`) works too, and it
 *   even REPLACES the transaction-local value the app set: the local value
 *   does not shadow it.
 *
 * So the database provides no protection of its own here.
 *
 * ## Why this is a second line of defense, not the only one
 *
 * `validate-query.ts` blocks `set_config`/`current_setting` in the keyword
 * list, and that blocklist is shared by every SQL-backed connector. It is
 * the first line and it holds. But it is ONE line: a connector that does
 * not go through the shared guard, or a spelling the blocklist misses,
 * turns directly into a cross-tenant read of the per-org upload tables
 * (the role has SELECT on every org schema — see migration 0018).
 *
 * This guard is the second line: it verifies the tenant context AFTER the
 * statement ran and BEFORE the rows can leave the transaction. A tampered
 * context aborts the transaction, so the rows never reach the client.
 *
 * The session-level value survives a rollback, so a detected tamper also
 * CLEARS the session GUCs: the connection returns to the pool with "no
 * org" (fail closed) instead of another tenant's id.
 */

/**
 * The GUCs that carry the tenant context:
 * `app.current_org_id`, `app.current_user_id` and `app.current_user_role`.
 *
 * The minimal surface the guard needs: something that can run a statement
 * inside the transaction that carried the user query.
 */
export interface OrgContextExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** What the wrapper set before the user statement ran. */
export interface ExpectedOrgContext {
  orgId: string;
  userId: string | null;
  role: string;
}

/**
 * `set_config(name, NULL, true)` leaves the GUC as the EMPTY STRING, not
 * NULL: `current_setting(name, true)` returns '' for it. The RLS policies
 * normalize it the same way (`NULLIF(current_setting(...), '')::uuid`), and
 * so does this guard.
 */
function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : text;
}

/**
 * Verify that the tenant context survived the statement that just ran.
 *
 * Throws `tenant.cross_tenant_access` (403) when it did not.
 */
export async function assertOrgContextIntact(
  tx: OrgContextExecutor,
  expected: ExpectedOrgContext,
): Promise<void> {
  const rows = await tx.execute(sql`
    SELECT
      current_setting('app.current_org_id', true) AS org_id,
      current_setting('app.current_user_id', true) AS user_id,
      current_setting('app.current_user_role', true) AS user_role
  `);

  const row = (Array.isArray(rows) ? rows[0] : undefined) as
    | { org_id?: unknown; user_id?: unknown; user_role?: unknown }
    | undefined;

  const actual = {
    orgId: normalize(row?.org_id),
    userId: normalize(row?.user_id),
    role: normalize(row?.user_role),
  };

  if (
    actual.orgId === expected.orgId &&
    actual.userId === expected.userId &&
    actual.role === expected.role
  ) {
    return;
  }

  // The connection is poisoned at the SESSION level, and a session-level
  // setting survives the rollback. Clean it before throwing: the next
  // transaction on this pooled connection must start from "no org" (fail
  // closed), not from another tenant's id.
  //
  // The GUC names are literals on purpose: they are a closed list, and
  // `set_config` takes the name as a plain text argument.
  await tx.execute(sql`SELECT set_config('app.current_org_id', '', false)`);
  await tx.execute(sql`SELECT set_config('app.current_user_id', '', false)`);
  await tx.execute(sql`SELECT set_config('app.current_user_role', '', false)`);

  // Deliberately opaque: the client learns that the access was denied, not
  // which tenant it tried to reach.
  throw new AppErrorException('tenant.cross_tenant_access', 'Acceso denegado.');
}
