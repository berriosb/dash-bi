-- Sprint 1.5: harden RLS policies to handle anonymous contexts.
--
-- Background: the threat model says anonymous callers (e.g., public share
-- links via `getPublicDashboard`) call `withOrgContext(orgId, null, fn)`.
-- Before this migration, `withOrgContext` set `app.current_user_id = ''`
-- which caused `current_setting(..., true)::uuid` to raise
-- `invalid input syntax for type uuid: ""` — leaking the error to the
-- API response instead of returning zero rows.
--
-- We now set the GUCs via `set_config(name, value, is_local=true)` which
-- accepts NULL. The policies need to also coerce NULL to a sentinel
-- UUID (the zero UUID `00000000-0000-0000-0000-000000000000`) so the
-- `::uuid` cast never fails. The sentinel UUID never matches a real
-- row, so anonymous queries return zero rows by construction.
--
-- This is a defense-in-depth tightening; the application layer
-- (`requirePermission` inside the `tx` callback) is what enforces user
-- membership for protected operations.

-- orgs: only see orgs where the current user is a member
DROP POLICY IF EXISTS "orgs_isolation" ON "orgs";
CREATE POLICY "orgs_isolation" ON "orgs"
  USING (id IN (
    SELECT org_id FROM org_members
    WHERE user_id = COALESCE(
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  ));

-- org_members: each user only sees their own memberships
DROP POLICY IF EXISTS "org_members_isolation" ON "org_members";
CREATE POLICY "org_members_isolation" ON "org_members"
  USING (user_id = COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  ));

-- Helper: org_id sentinel for anonymous callers. Same trick.
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_org_id', true), '')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
$$;

-- Re-issue the per-table policies using the helper.
DROP POLICY IF EXISTS "data_sources_isolation" ON "data_sources";
CREATE POLICY "data_sources_isolation" ON "data_sources"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "dashboards_isolation" ON "dashboards";
CREATE POLICY "dashboards_isolation" ON "dashboards"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "dashboard_versions_isolation" ON "dashboard_versions";
CREATE POLICY "dashboard_versions_isolation" ON "dashboard_versions"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "public_links_isolation" ON "public_links";
CREATE POLICY "public_links_isolation" ON "public_links"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "llm_usage_isolation" ON "llm_usage";
CREATE POLICY "llm_usage_isolation" ON "llm_usage"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "audit_log_isolation" ON "audit_log";
CREATE POLICY "audit_log_isolation" ON "audit_log"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "nlqa_conversations_isolation" ON "nlqa_conversations";
CREATE POLICY "nlqa_conversations_isolation" ON "nlqa_conversations"
  USING (
    org_id = app_current_org_id()
    AND user_id = COALESCE(
      NULLIF(current_setting('app.current_user_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

DROP POLICY IF EXISTS "nlqa_messages_isolation" ON "nlqa_messages";
CREATE POLICY "nlqa_messages_isolation" ON "nlqa_messages"
  USING (org_id = app_current_org_id());