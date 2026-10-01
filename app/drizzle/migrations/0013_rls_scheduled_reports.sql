-- Sprint 3 hardening: Row Level Security on the scheduled-report tables.
--
-- `scheduled_reports` and `scheduled_report_runs` were created by
-- 0009_scheduled_reports.sql with `org_id`, foreign keys and indexes — and
-- no RLS statements at all. The application layer filters by `org_id` in
-- every handler, so this is not an active leak today, but the backstop that
-- docs/security/threat-model.md §T1 declares as the multi-tenant boundary
-- did not exist here. `scheduled_reports` is the table that decides WHO
-- receives business data by email on a cron schedule, so a single forgotten
-- `.where(orgId)` would have both crossed tenants and mis-delivered mail.
--
-- Policies use the null-safe `app_current_org_id()` helper from
-- 0004_rls_null_safe.sql, not raw `current_setting(...)::uuid`, so
-- anonymous callers (public share links) resolve to the sentinel UUID and
-- match zero rows instead of raising `invalid input syntax for type uuid`.
--
-- Hand-written and idempotent, following the precedent of
-- 0012_rls_alert_rules.sql: ENABLE, then FORCE (so the policies also apply
-- to the table owner, which is how the app connects), then DROP/CREATE
-- each policy.
--
-- NOT included here: `orgs`. It also has an `orgs_isolation` policy with no
-- matching ENABLE, so that policy is inert — but enabling it is NOT a
-- drop-in fix. See the note at the bottom of this file.

-- ─────────────────────────────────────────────────────────────────
-- 1) scheduled_reports
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE "scheduled_reports" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "scheduled_reports" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduled_reports_isolation" ON "scheduled_reports";
CREATE POLICY "scheduled_reports_isolation" ON "scheduled_reports"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "scheduled_reports_insert" ON "scheduled_reports";
CREATE POLICY "scheduled_reports_insert" ON "scheduled_reports"
  WITH CHECK (org_id = app_current_org_id());

-- ─────────────────────────────────────────────────────────────────
-- 2) scheduled_report_runs
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE "scheduled_report_runs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "scheduled_report_runs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduled_report_runs_isolation" ON "scheduled_report_runs";
CREATE POLICY "scheduled_report_runs_isolation" ON "scheduled_report_runs"
  USING (org_id = app_current_org_id());

DROP POLICY IF EXISTS "scheduled_report_runs_insert" ON "scheduled_report_runs";
CREATE POLICY "scheduled_report_runs_insert" ON "scheduled_report_runs"
  WITH CHECK (org_id = app_current_org_id());

-- ─────────────────────────────────────────────────────────────────
-- 3) `orgs` is deliberately NOT enabled here
-- ─────────────────────────────────────────────────────────────────
--
-- `orgs` has had a policy since 0001 (re-issued in 0004) but no
-- `ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY`, so it has never filtered
-- anything. Enabling it looks like a one-liner and is not, because three
-- legitimate code paths read or write `orgs` deliberately ACROSS the current
-- org boundary:
--
--   a) api/organizations/route.ts:30-39 — the org switcher. It inner-joins
--      `org_members` filtered by `userId` so a user who belongs to three orgs
--      can list all three. A policy of `id = app_current_org_id()` would
--      return exactly one, silently breaking the switcher.
--
--   b) lib/auth/config.ts:34-100 `provisionOrgForUser` — signup. It sets
--      `app.current_org_id` to the NEW USER's id (not an org id) so the
--      `org_members` policy passes, then INSERTs the org. Under
--      `id = app_current_org_id()` that INSERT would be rejected, because
--      the org's own id is not known until the row exists.
--
--   c) lib/auth/config.ts:22-32 `uniqueSlug` — a global uniqueness probe on
--      `orgs.slug` that must see rows from every org.
--
-- The obvious correct policy, "orgs this user is a member of", needs
-- `EXISTS (SELECT 1 FROM org_members WHERE user_id = app_current_user_id())`,
-- and `org_members` has its own RLS — which Postgres rejects with
-- `infinite recursion detected in policy` unless the lookup goes through a
-- SECURITY DEFINER function that bypasses RLS.
--
-- So closing this one is a design change, not a migration: it needs either
-- (i) a SECURITY DEFINER helper such as `app_user_org_ids()` that reads
-- `org_members` while owned by a role exempt from RLS, and a policy using
-- it, or (ii) a dedicated GUC that a single narrow system path sets, with
-- every other access still org-scoped.
--
-- Until one of those exists, `orgs` isolation rests entirely on the explicit
-- `eq(orgs.id, orgId)` / `eq(orgMembers.userId, userId)` predicates in the
-- six handlers that read it. That is thin, and it is the last tenant-scoped
-- table in the schema without a RLS backstop. Tracked, not forgotten.
