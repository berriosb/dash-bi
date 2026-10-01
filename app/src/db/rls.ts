import { sql } from 'drizzle-orm';
import { db, withSystemContext } from './client';
import { parseBareIdent, quoteIdent } from '@/lib/connectors/parsers/sql-ident';

/**
 * Habilita Row Level Security en todas las tablas tenant-scoped.
 * Ejecutar UNA VEZ en setup, no en cada boot.
 *
 * These run as the migration/owner role, not the app role. DDL is not subject
 * to RLS, so `withSystemContext` is a plain transaction here — the privilege
 * comes from the connection, not from a bypass. Nothing in `src/app/api` calls
 * this; see the guard in tests/unit/db/system-context-usage.test.ts.
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
    // Sprint 3: NLQA tables are tenant-scoped (org_id) and additionally
    // user-scoped for conversations (user_id).
    'nlqa_conversations',
    'nlqa_messages',
    // Sprint 3: alerting tables, tenant-scoped (org_id).
    'alert_rules',
    'alert_events',
  ];
  // NOTE: 'users', 'accounts', 'verifications' are GLOBAL (not tenant-scoped).
  // Better-auth manages them; RLS not enabled because access is gated by better-auth session + JWT.
  // 'sessions' is also managed by better-auth; org_members provides tenant binding.

  await withSystemContext(async () => {
    for (const table of tables) {
      // These come from a literal in this file, so validation is defense in
      // depth — but it costs nothing and keeps every `sql.raw` identifier in
      // the codebase going through the same grammar (T3).
      const ident = quoteIdent(parseBareIdent(table, 'rls table'));
      await db.execute(sql.raw(`ALTER TABLE ${ident} ENABLE ROW LEVEL SECURITY`));
      // FORCE también para table owners (defense in depth)
      await db.execute(sql.raw(`ALTER TABLE ${ident} FORCE ROW LEVEL SECURITY`));
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

    // org_members: ve solo memberships propias o de la org activa
    `CREATE POLICY org_members_isolation ON org_members
      USING (
        user_id = current_setting('app.current_user_id', true)::uuid
        OR org_id = current_setting('app.current_org_id', true)::uuid
      )`,

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

    // Sprint 3: NLQA conversations — solo el dueño ve sus conversaciones.
    `CREATE POLICY nlqa_conversations_isolation ON nlqa_conversations
      USING (
        org_id = current_setting('app.current_org_id')::uuid
        AND user_id = current_setting('app.current_user_id')::uuid
      )`,

    // Sprint 3: NLQA messages — org_id filtering (la conversación ya está
    // protegida por user_id, así que las messages de esa conv son seguras).
    `CREATE POLICY nlqa_messages_isolation ON nlqa_messages
      USING (org_id = current_setting('app.current_org_id')::uuid)`,

    // Sprint 3: alert_rules — filtra por org_id.
    // Uses the null-safe app_current_org_id() helper from
    // 0004_rls_null_safe.sql, not the bare current_setting()::uuid used by
    // the older policies above: without the missing-ok flag, current_setting
    // raises instead of returning NULL when the GUC was never set, so an
    // anonymous caller would error rather than match zero rows.
    `CREATE POLICY alert_rules_isolation ON alert_rules
      USING (org_id = app_current_org_id())`,

    // Sprint 3: alert_events — filtra por org_id (mismo criterio null-safe)
    `CREATE POLICY alert_events_isolation ON alert_events
      USING (org_id = app_current_org_id())`,
  ];

  await withSystemContext(async () => {
    for (const policy of policies) {
      // DROP primero (idempotente)
      const policyName = policy.match(/CREATE POLICY (\w+)/)?.[1];
      if (policyName) {
        const quotedPolicy = quoteIdent(parseBareIdent(policyName, 'policy'));
        const table = getTableFromPolicy(policy);
        await db.execute(
          sql.raw(
            `DROP POLICY IF EXISTS ${quotedPolicy} ON ${quoteIdent(parseBareIdent(table, 'rls table'))}`,
          ),
        );
      }
      await db.execute(sql.raw(policy));
    }
  });
}

function getTableFromPolicy(policySql: string): string {
  const match = policySql.match(/ON (\w+)/);
  return match?.[1] || '';
}