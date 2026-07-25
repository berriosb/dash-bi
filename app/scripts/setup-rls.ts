#!/usr/bin/env tsx
/**
 * Setup script: enable RLS policies on existing databases.
 *
 * Run this AFTER `pnpm db:migrate` (which applies the SQL files).
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   pnpm db:setup-rls
 *
 * Reads DATABASE_URL from process.env. .env.local should be loaded by the
 * user (`set -a; source .env.local; set +a`) or by Docker / CI runtime.
 *
 * See src/db/rls.ts for the programmatic version (used by tests).
 */

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is required');
  process.exit(1);
}

const TABLES = [
  'data_sources',
  'dashboards',
  'dashboard_versions',
  'public_links',
  'llm_usage',
  'audit_log',
  'org_members',
];

const POLICIES = [
  {
    name: 'orgs_isolation',
    table: 'orgs',
    sql: `CREATE POLICY orgs_isolation ON orgs
      USING (id IN (
        SELECT org_id FROM org_members
        WHERE user_id = current_setting('app.current_user_id', true)::uuid
      ))`,
  },
  {
    name: 'org_members_isolation',
    table: 'org_members',
    sql: `CREATE POLICY org_members_isolation ON org_members
      USING (user_id = current_setting('app.current_user_id', true)::uuid)`,
  },
  {
    name: 'data_sources_isolation',
    table: 'data_sources',
    sql: `CREATE POLICY data_sources_isolation ON data_sources
      USING (org_id = current_setting('app.current_org_id', true)::uuid)`,
  },
  {
    name: 'dashboards_isolation',
    table: 'dashboards',
    sql: `CREATE POLICY dashboards_isolation ON dashboards
      USING (org_id = current_setting('app.current_org_id', true)::uuid)`,
  },
  {
    name: 'dashboard_versions_isolation',
    table: 'dashboard_versions',
    sql: `CREATE POLICY dashboard_versions_isolation ON dashboard_versions
      USING (org_id = current_setting('app.current_org_id', true)::uuid)`,
  },
  {
    name: 'public_links_isolation',
    table: 'public_links',
    sql: `CREATE POLICY public_links_isolation ON public_links
      USING (org_id = current_setting('app.current_org_id', true)::uuid)`,
  },
  {
    name: 'llm_usage_isolation',
    table: 'llm_usage',
    sql: `CREATE POLICY llm_usage_isolation ON llm_usage
      USING (org_id = current_setting('app.current_org_id', true)::uuid)`,
  },
  {
    name: 'audit_log_isolation',
    table: 'audit_log',
    sql: `CREATE POLICY audit_log_isolation ON audit_log
      USING (org_id = current_setting('app.current_org_id', true)::uuid)`,
  },
];

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1 });

  try {
    console.log('🔐 Enabling RLS on tenant-scoped tables…');

    for (const table of TABLES) {
      await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await sql.unsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      console.log(`  ✓ ${table}`);
    }

    console.log('📋 Creating RLS policies…');

    for (const policy of POLICIES) {
      await sql.unsafe(`DROP POLICY IF EXISTS ${policy.name} ON ${policy.table}`);
      await sql.unsafe(policy.sql);
      console.log(`  ✓ ${policy.name}`);
    }

    console.log('\n✅ RLS setup complete.');
    console.log('\nℹ️  Tables NOT under RLS (global, better-auth managed):');
    console.log('   - users, accounts, verifications, sessions, orgs (read via membership policy)');
  } catch (error) {
    console.error('❌ RLS setup failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();