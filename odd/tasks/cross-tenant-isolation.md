# Fix: cross-tenant isolation leaks (CRITICAL-1, CRITICAL-2)

**Branch:** `fix/cross-tenant-isolation`
**Source audit:** `docs/audits/2026-09-30-code-audit/CODIGO-AUDIT.md`
**Status:** in progress

## Context

Two confirmed cross-tenant data leaks. Every finding below was re-verified by
direct code reading before entering this feature; line references are the
verified ones, not the audit's.

Both leaks share one root cause the audit identified: security controls are
tested as isolated functions instead of through their real execution path. The
tests added here follow the repo's existing route-handler test pattern (call the
exported handler with a real `Request` and mocked `requireAuth` / `withOrgContext`),
which is the closest thing to the HTTP path the current architecture allows.

## Tasks

### 1. CRITICAL-1 — persist job ownership and enforce it on read

`app/src/lib/export/pdf-enqueue.ts`, `app/src/app/api/dashboards/[id]/export/pdf/route.ts`

- `enqueuePdfExport` persists `{ url, options, branding }` (pdf-enqueue.ts:53-57)
  and discards `opts.orgId`, `opts.userId` and `opts.dashboardId`. `opts.userId`
  is accepted and never read.
- `getPdfJobStatus(jobId)` (pdf-enqueue.ts:79-80) does `getQueue().getJob(jobId)`
  and returns the buffer with no ownership check at all.
- The GET handler (route.ts:42-81) takes `dashboardId` from the path, uses it only
  for `filename` and the audit log, and never crosses it with the job.
- BullMQ job ids are sequential integers, so `?jobId=N` enumerates every tenant's
  rendered dashboards. Redis is not covered by RLS.
- Second enqueue call site exists and must keep working: `app/src/lib/reports/runner.ts:48-52`.
- The worker (`app/src/worker/render-pdf.ts:4-8`) reads only `url`, `options` and
  `branding`, so extending the payload is backward compatible.

### 2. CRITICAL-1 — regression test through the route

`app/tests/unit/api/pdf-export.test.ts`, `app/tests/unit/export/pdf-enqueue.test.ts`

- Route test: a job whose owning org differs from `ctx.orgId` must not yield the
  buffer. Enumeration (`jobId=1,2,3…`) must yield nothing across orgs.
- Unit test: `getPdfJobStatus` rejects a mismatched owner; accepts the matching one.
- Existing tests in both files must keep passing (payload-shape assertions on
  `enqueuePdfExport` will need updating for the new fields).

### 3. CRITICAL-2 — close the alert rules read leak and the insert leak

`app/src/app/api/dashboards/[id]/alerts/route.ts`

- `GET` (route.ts:110-117) filters only on `eq(alertRules.dashboardId, dashboardId)`.
  `alert_rules` has no RLS in any of the 12 migrations, so the app-layer filter is
  the only boundary and it is missing `orgId`.
- Undocumented sibling leak: `POST` (route.ts:66-83) inserts a rule carrying a
  `dashboardId` taken straight from the URL with no ownership lookup against
  `dashboards`. An attacker can attach an alert rule to another tenant's dashboard.
  Found during implementation mapping; not in the original audit.
- Verified NOT leaking, leave alone: `PATCH` and `DELETE` in `alert-rules/[id]`
  (both already `and(eq(id), eq(orgId))`), `test-channel` (same), and
  `GET alert-rules/[id]/events` (already `and(eq(alertRuleId), eq(orgId))`).

### 4. CRITICAL-2 — regression test through the route

`app/tests/unit/api/alert-rules.test.ts` (new)

- No route test exists for alerts today. `tests/unit/alerts/*` only cover pure
  library logic with no `requireAuth` / `withOrgContext`.
- GET with a foreign `dashboardId` must not return another org's rules.
- POST with a foreign `dashboardId` must be rejected before any insert.

### 5. Database-level RLS for `alert_rules` and `alert_events`

`app/drizzle/migrations/0012_*.sql` (new), `app/drizzle/migrations/meta/_journal.json`,
`app/src/db/rls.ts`

- Neither table has `ENABLE` or `FORCE ROW LEVEL SECURITY`; both are created in
  `0010_strange_monster_badoon.sql` with only FKs and indexes.
- This is the third diverging RLS source in the repo. `scripts/setup-rls.ts:88-100`
  does define policies for both, but nothing in CI, compose or `db:migrate` ever
  runs it. `src/db/rls.ts:6-27` (`enableRLS`) does not list either table.
- Migration follows the hand-written idempotent format of `0007_uploaded_files.sql`
  (`IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `CREATE POLICY`) and uses the
  `app_current_org_id()` helper introduced by `0004_rls_null_safe.sql:41-48`,
  not the raw `current_setting(...)::uuid` that `setup-rls.ts` uses.
- Requires a `_journal.json` entry (`idx: 12`) or `pnpm db:migrate` will skip it.
- The integration suite applies every `.sql` in the directory regardless of the
  journal (`tests/integration/postgres.ts:64-70`), so it will pick the file up.
- Fixes the HIGH-4 `uploaded_files` missing `FORCE` at the same time, since it is
  the same defect class in the same migration.

### 6. Verification gate

- `pnpm lint:strict && pnpm typecheck && pnpm test && pnpm build` from `app/`.
- RLS integration tests require Docker, which is unavailable on this machine
  (`/usr/bin/docker` present, user not in the `docker` group). They will report
  as skipped locally and must be confirmed in CI, where `RLS_TESTS_REQUIRED=1`
  forces them to run.

## Out of scope

- HIGH-5 (app role is a superuser, so RLS is bypassed entirely). Unconfirmed
  against a live database; changing it touches compose and env contracts and needs
  a deployment decision from the human.
- CRITICAL-3 / HIGH-1 (the `viewer` PII filter is dead code and the regex is
  evadable). Separate feature.
- The uncommitted design-token work in the working tree
  (`globals.css`, `layout.tsx`, `DashboardControls.tsx`, `package.json`,
  `pnpm-lock.yaml`) belongs to another agent and stays untouched. Never
  `git add -A` on this branch.

## Commits

| Task | Commit | Status |
|---|---|---|
| 1 | — | pending |
| 2 | — | pending |
| 3 | — | pending |
| 4 | — | pending |
| 5 | — | pending |
| 6 | — | pending |
