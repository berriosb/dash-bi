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
 * Reads DATABASE_MIGRATION_URL (the table owner) from process.env, falling
 * back to DATABASE_URL for local dev. `.env.local` should be loaded by the
 * user (`set -a; source .env.local; set +a`) or by Docker / CI runtime.
 *
 * The owner URL is preferred on purpose: creating policies requires
 * ownership, and the migration role lives in a throwaway container rather
 * than in the long-lived app — which is why HIGH-5 forbids the app's own
 * DATABASE_URL from being the superuser.
 *
 * See src/db/rls.ts for the programmatic version (used by tests).
 */

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_MIGRATION_URL (or DATABASE_URL) is required');
  process.exit(1);
}

const TABLES = [
  'orgs',
  'data_sources',
  'dashboards',
  'dashboard_versions',
  'public_links',
  'llm_usage',
  'audit_log',
  'org_members',
  'uploaded_files',
  'nlqa_conversations',
  'nlqa_messages',
  'alert_rules',
  'alert_events',
  'scheduled_reports',
  'scheduled_report_runs',
];

const POLICIES = [
  {
    name: 'orgs_read',
    table: 'orgs',
    sql: `CREATE POLICY orgs_read ON orgs
      FOR SELECT
      USING (dashbi_user_belongs_to_org(id))`,
  },
  {
    name: 'orgs_update',
    table: 'orgs',
    sql: `CREATE POLICY orgs_update ON orgs
      FOR UPDATE
      USING (dashbi_user_belongs_to_org(id))
      WITH CHECK (dashbi_user_belongs_to_org(id))`,
  },
  {
    name: 'orgs_insert',
    table: 'orgs',
    sql: `CREATE POLICY orgs_insert ON orgs
      FOR INSERT
      WITH CHECK (NULLIF(current_setting('app.current_user_id', true), '')::uuid IS NOT NULL)`,
  },
  {
    name: 'org_members_isolation',
    table: 'org_members',
    sql: `CREATE POLICY org_members_isolation ON org_members
      USING (
        user_id = COALESCE(
          NULLIF(current_setting('app.current_user_id', true), '')::uuid,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
        OR org_id = app_current_org_id()
      )
      WITH CHECK (
        user_id = COALESCE(
          NULLIF(current_setting('app.current_user_id', true), '')::uuid,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
        OR org_id = app_current_org_id()
      )`,
  },
  {
    name: 'data_sources_isolation',
    table: 'data_sources',
    sql: `CREATE POLICY data_sources_isolation ON data_sources
      USING (org_id = app_current_org_id())`,
  },
  {
    name: 'dashboards_isolation',
    table: 'dashboards',
    sql: `CREATE POLICY dashboards_isolation ON dashboards
      USING (org_id = app_current_org_id())`,
  },
  {
    name: 'dashboard_versions_isolation',
    table: 'dashboard_versions',
    sql: `CREATE POLICY dashboard_versions_isolation ON dashboard_versions
      USING (org_id = app_current_org_id())`,
  },
  {
    name: 'public_links_isolation',
    table: 'public_links',
    sql: `CREATE POLICY public_links_isolation ON public_links
      USING (org_id = app_current_org_id())`,
  },
  {
    name: 'llm_usage_isolation',
    table: 'llm_usage',
    sql: `CREATE POLICY llm_usage_isolation ON llm_usage
      USING (org_id = app_current_org_id())`,
  },
  {
    name: 'audit_log_isolation',
    table: 'audit_log',
    sql: `CREATE POLICY audit_log_isolation ON audit_log
      USING (org_id = app_current_org_id())`,
  },
  {
    name: 'uploaded_files_isolation',
    table: 'uploaded_files',
    sql: `CREATE POLICY uploaded_files_isolation ON uploaded_files
      USING (org_id = app_current_org_id())
      WITH CHECK (org_id = app_current_org_id())`,
  },
  {
    name: 'nlqa_conversations_isolation',
    table: 'nlqa_conversations',
    sql: `CREATE POLICY nlqa_conversations_isolation ON nlqa_conversations
      USING (
        org_id = app_current_org_id()
        AND user_id = COALESCE(
          NULLIF(current_setting('app.current_user_id', true), '')::uuid,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
      )`,
  },
  {
    name: 'nlqa_messages_isolation',
    table: 'nlqa_messages',
    sql: `CREATE POLICY nlqa_messages_isolation ON nlqa_messages
      USING (org_id = app_current_org_id())`,
  },
  {
    name: 'alert_rules_isolation',
    table: 'alert_rules',
    sql: `CREATE POLICY alert_rules_isolation ON alert_rules
      USING (org_id = app_current_org_id())
      WITH CHECK (org_id = app_current_org_id())`,
  },
  {
    name: 'alert_events_isolation',
    table: 'alert_events',
    sql: `CREATE POLICY alert_events_isolation ON alert_events
      USING (org_id = app_current_org_id())
      WITH CHECK (org_id = app_current_org_id())`,
  },
  {
    name: 'scheduled_reports_isolation',
    table: 'scheduled_reports',
    sql: `CREATE POLICY scheduled_reports_isolation ON scheduled_reports
      USING (org_id = app_current_org_id())
      WITH CHECK (org_id = app_current_org_id())`,
  },
  {
    name: 'scheduled_report_runs_isolation',
    table: 'scheduled_report_runs',
    sql: `CREATE POLICY scheduled_report_runs_isolation ON scheduled_report_runs
      USING (org_id = app_current_org_id())
      WITH CHECK (org_id = app_current_org_id())`,
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