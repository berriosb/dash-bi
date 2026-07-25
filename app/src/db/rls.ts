import { sql } from 'drizzle-orm';
import { db, withSystemContext } from './client';

/**
 * Habilita Row Level Security en todas las tablas tenant-scoped.
 * Ejecutar UNA VEZ en setup, no en cada boot.
 */
export async function enableRLS(): Promise<void> {
  const tables = [
    'data_sources',
    'dashboards',
    'dashboard_versions',
    'public_links',
    'llm_usage',
    'audit_log',
    'org_members',
  ];
  // NOTE: 'users', 'accounts', 'verifications' are GLOBAL (not tenant-scoped).
  // Better-auth manages them; RLS not enabled because access is gated by better-auth session + JWT.
  // 'sessions' is also managed by better-auth; org_members provides tenant binding.

  await withSystemContext(async () => {
    for (const table of tables) {
      await db.execute(sql.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      // FORCE también para table owners (defense in depth)
      await db.execute(sql.raw(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    }
  });
}

/**
 * Crea las RLS policies para aislamiento multi-tenant.
 * Lee `app.current_org_id` que setea withOrgContext().
 */
export async function createRLSPolicies(): Promise<void> {
  const policies = [
    // orgs: solo ve orgs donde es miembro
    `CREATE POLICY orgs_isolation ON orgs
      USING (id IN (
        SELECT org_id FROM org_members
        WHERE user_id = current_setting('app.current_user_id')::uuid
      ))`,

    // org_members: ve solo memberships propias
    `CREATE POLICY org_members_isolation ON org_members
      USING (user_id = current_setting('app.current_user_id')::uuid)`,

    // data_sources: filtra por org_id
    `CREATE POLICY data_sources_isolation ON data_sources
      USING (org_id = current_setting('app.current_org_id')::uuid)`,

    // dashboards: filtra por org_id
    `CREATE POLICY dashboards_isolation ON dashboards
      USING (org_id = current_setting('app.current_org_id')::uuid)`,

    // dashboard_versions: filtra por org_id
    `CREATE POLICY dashboard_versions_isolation ON dashboard_versions
      USING (org_id = current_setting('app.current_org_id')::uuid)`,

    // public_links: filtra por org_id
    `CREATE POLICY public_links_isolation ON public_links
      USING (org_id = current_setting('app.current_org_id')::uuid)`,

    // llm_usage: filtra por org_id
    `CREATE POLICY llm_usage_isolation ON llm_usage
      USING (org_id = current_setting('app.current_org_id')::uuid)`,

    // audit_log: filtra por org_id
    `CREATE POLICY audit_log_isolation ON audit_log
      USING (org_id = current_setting('app.current_org_id')::uuid)`,
  ];

  await withSystemContext(async () => {
    for (const policy of policies) {
      // DROP primero (idempotente)
      const policyName = policy.match(/CREATE POLICY (\w+)/)?.[1];
      if (policyName) {
        await db.execute(sql.raw(`DROP POLICY IF EXISTS ${policyName} ON ${getTableFromPolicy(policy)}`));
      }
      await db.execute(sql.raw(policy));
    }
  });
}

function getTableFromPolicy(policySql: string): string {
  const match = policySql.match(/ON (\w+)/);
  return match?.[1] || '';
}