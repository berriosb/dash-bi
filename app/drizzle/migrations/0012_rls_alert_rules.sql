-- Sprint 3 hardening: Row Level Security on the alerting tables.
--
-- `alert_rules` and `alert_events` were introduced by
-- 0010_strange_monster_badoon.sql with foreign keys and indexes only —
-- no RLS statements at all. The application layer filters by `org_id` on
-- every route, so this is not an active leak, but the RLS backstop that
-- docs/security/threat-model.md §T1 declares as the multi-tenant boundary
-- did not exist for these two tables. A single forgotten `.where(orgId)`
-- would have crossed tenants silently.
--
-- Policies use the null-safe `app_current_org_id()` helper introduced by
-- 0004_rls_null_safe.sql, not raw `current_setting(...)::uuid`, so
-- anonymous callers (public share links) resolve to the sentinel UUID and
-- match zero rows instead of raising `invalid input syntax for type uuid`.
--
-- Hand-written and idempotent, following the precedent of
-- 0007_uploaded_files.sql: ENABLE, then FORCE (so the policies also apply
-- to the table owner, which is how the app connects), then DROP/CREATE
-- each policy.

-- ─────────────────────────────────────────────────────────────────
-- 1) alert_rules
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "alert_rules" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alert_rules_isolation" ON "alert_rules";
CREATE POLICY "alert_rules_isolation" ON "alert_rules"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "alert_rules_insert" ON "alert_rules";
CREATE POLICY "alert_rules_insert" ON "alert_rules"
  WITH CHECK (org_id = app_current_org_id());

-- ─────────────────────────────────────────────────────────────────
-- 2) alert_events
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE "alert_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "alert_events" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alert_events_isolation" ON "alert_events";
CREATE POLICY "alert_events_isolation" ON "alert_events"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "alert_events_insert" ON "alert_events";
CREATE POLICY "alert_events_insert" ON "alert_events"
  WITH CHECK (org_id = app_current_org_id());

-- ─────────────────────────────────────────────────────────────────
-- 3) HIGH-4 fix: RLS on uploaded_files was inert for the table owner.
-- ─────────────────────────────────────────────────────────────────
--
-- 0007_uploaded_files.sql enabled RLS on `uploaded_files` but never issued
-- `FORCE ROW LEVEL SECURITY`. Without FORCE a table owner is exempt from
-- its own policies, and the app connects as the owner — so the isolation
-- policy added in 0007 never actually filtered any row.
--
-- Fixed here instead of by editing 0007: migrations that have already run
-- are immutable, and editing one would not re-apply on existing databases.

ALTER TABLE "uploaded_files" FORCE ROW LEVEL SECURITY;
