-- Enable Row Level Security on tenant-scoped tables and create isolation policies.
-- See docs/security/threat-model.md §T1 and src/db/rls.ts for details.
--
-- IMPORTANT: This migration must run AFTER 0000_initial.sql. It is idempotent.

-- ─────────────────────────────────────────────────────────────────
-- 1) ENABLE + FORCE RLS on tenant-scoped tables
-- Defense in depth: even table owners are subject to RLS via FORCE.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE "data_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "dashboards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "dashboard_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "public_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "llm_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────
-- 2) RLS POLICIES
-- Read `app.current_org_id` / `app.current_user_id` / `app.current_user_role`
-- set by withOrgContext() wrapper.
-- ─────────────────────────────────────────────────────────────────

-- orgs: only see orgs where the current user is a member
DROP POLICY IF EXISTS "orgs_isolation" ON "orgs";--> statement-breakpoint
CREATE POLICY "orgs_isolation" ON "orgs"
  USING (id IN (
    SELECT org_id FROM org_members
    WHERE user_id = current_setting('app.current_user_id', true)::uuid
  ));--> statement-breakpoint

-- org_members: each user only sees their own memberships
DROP POLICY IF EXISTS "org_members_isolation" ON "org_members";--> statement-breakpoint
CREATE POLICY "org_members_isolation" ON "org_members"
  USING (user_id = current_setting('app.current_user_id', true)::uuid);--> statement-breakpoint

-- data_sources
DROP POLICY IF EXISTS "data_sources_isolation" ON "data_sources";--> statement-breakpoint
CREATE POLICY "data_sources_isolation" ON "data_sources"
  USING (org_id = current_setting('app.current_org_id', true)::uuid);--> statement-breakpoint

-- dashboards
DROP POLICY IF EXISTS "dashboards_isolation" ON "dashboards";--> statement-breakpoint
CREATE POLICY "dashboards_isolation" ON "dashboards"
  USING (org_id = current_setting('app.current_org_id', true)::uuid);--> statement-breakpoint

-- dashboard_versions
DROP POLICY IF EXISTS "dashboard_versions_isolation" ON "dashboard_versions";--> statement-breakpoint
CREATE POLICY "dashboard_versions_isolation" ON "dashboard_versions"
  USING (org_id = current_setting('app.current_org_id', true)::uuid);--> statement-breakpoint

-- public_links
DROP POLICY IF EXISTS "public_links_isolation" ON "public_links";--> statement-breakpoint
CREATE POLICY "public_links_isolation" ON "public_links"
  USING (org_id = current_setting('app.current_org_id', true)::uuid);--> statement-breakpoint

-- llm_usage
DROP POLICY IF EXISTS "llm_usage_isolation" ON "llm_usage";--> statement-breakpoint
CREATE POLICY "llm_usage_isolation" ON "llm_usage"
  USING (org_id = current_setting('app.current_org_id', true)::uuid);--> statement-breakpoint

-- audit_log
DROP POLICY IF EXISTS "audit_log_isolation" ON "audit_log";--> statement-breakpoint
CREATE POLICY "audit_log_isolation" ON "audit_log"
  USING (org_id = current_setting('app.current_org_id', true)::uuid);--> statement-breakpoint