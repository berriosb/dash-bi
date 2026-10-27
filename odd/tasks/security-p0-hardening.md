# Fix: security P0 hardening (audit 2026-09-30 follow-up)

**Branch:** `fix/security-p0-hardening`
**Source:** repo-wide security audit (4 parallel control sweeps + parent verification)
**Status:** in progress
**Scope:** P0 only. P1/P2 findings are recorded in the audit report and left for a
follow-up feature — this feature must not grow into a multi-area rewrite.

## Context

The audit verdict was **FAIL**: 3 CRITICAL dependency advisories and 8 HIGH
application findings. Every finding below was re-verified by reading the code
before entering this feature; the line references are the verified ones.

Two constraints shape the work:

1. **The working tree carries unrelated uncommitted work.** 57 files (UI/brand
   changes) are modified in the working tree and are NOT part of this feature.
   Every commit in this feature must stage files explicitly — never `git add -A`.
   Files already modified by that work are off-limits for editing; the fixes
   below are deliberately scoped to server-side files instead.
2. **`docs/security/threat-model.md` marks controls `[x]` that do not exist in
   the code.** That documentation drift is why these gaps survived. The threat
   model is corrected as part of this feature so the checkboxes mean something
   again.

## Tasks

### 1. Patch critical dependencies and make the audit gate real

`app/package.json`, `app/pnpm-lock.yaml`, `.github/workflows/ci.yml`, `app/security-audit-baseline.json`, `docs/security/accepted-advisories.md`

**Status: done.**

- `next@16.3.8` (direct dependency) carries two CRITICAL unauthenticated RCE
  advisories, patched in `>=16.4.1` (unauthenticated RCE in `use cache`, and in
  Image Optimization). The declared range is already `^16.3.8`.
- `@sentry/nextjs@9.47.1` carries a CRITICAL middleware-bypass advisory, patched
  in `>=9.47.2`. The advisory concerns the tunnel route; the repo does not use a
  tunnel (`grep tunnel` over `app/sentry*.ts` and `app/src` returns nothing), so
  it is not reachable — but the version is still vulnerable and must move.
- The audit gate is inert. `app/package.json` defines `audit:check`
  (`node scripts/check-audit-baseline.mjs`), but the workflow that calls it
  lives at `app/.github/workflows/ci.yml`. GitHub Actions only discovers
  workflows under the repository-root `.github/workflows/`, so that job never
  runs. The root `ci.yml` has no audit step at all.
- `app/security-audit-baseline.json` declares `critical: 0, high: 3`, while a
  live `pnpm audit --audit-level=high` reports 3 critical and 7 high. The
  baseline is stale and was never enforced, so it drifted silently.

**What was done**

- `next` → `^16.4.3` (installed 16.4.3), `@sentry/nextjs` → `^9.47.2`
  (installed 9.47.2). No major-version jump.
- `pnpm.overrides`: `undici` `^6.28.1` → `^6.29.1` (clears GHSA-xjj6-f33q-929c);
  new `zod@^4.0.0` → `^4.6.6`, a range-scoped override that pins only the zod 4
  branch (better-auth's) to a patched version and leaves the project's direct
  `zod@3.25.76` alone.
- The `audit` job moved into the repository-root `.github/workflows/ci.yml` and
  runs `pnpm audit:check`. The inert `app/.github/workflows/ci.yml` was deleted
  — it duplicated the root workflow and was the reason the gate never existed.
- Baseline refreshed to the real post-patch numbers (`critical: 0, high: 4`)
  with the four live advisory ids.
- `docs/security/accepted-advisories.md` documents the two new accepted
  advisories (`zod` 1243066, `happy-dom` 1243084) and records the fixes.

**Not fixed, with reasons** (both documented in the advisories file)

- `zod` 1243066 — the vulnerable range is `<4.6.6`, which covers every 3.x
  release; the fix requires migrating the project to zod 4. Out of scope for a
  security patch.
- `happy-dom` 1243084 — dev-only, never ships in a runtime container. The
  `vitest>happy-dom` override does not move it because `happy-dom` is an
  optional *peer* of Vitest, resolved by the lockfile rather than by range.

**Evidence**

- `pnpm audit --audit-level=high --json` → `critical 0, high 4, moderate 21, low 2`
- `pnpm audit:check` → `critical 0/0, high 4/4` → `within the accepted baseline`, exit 0
- `pnpm lint:strict` → exit 0 (0 errors, 0 warnings)
- `pnpm typecheck` → exit 0
- `pnpm test` → exit 0 — `Test Files 157 passed (157)`, `Tests 1797 passed (1797)`, 0 failed, 0 skipped
- `pnpm build` → exit 0 — Next.js 16.4.3 (webpack), 20/20 static pages, 57 routes, no collisions
- Rollback boundary: `git revert` of the task commit restores `next@16.3.8`,
  `@sentry/nextjs@9.47.1`, the old overrides, the baseline and the inert
  workflow file. Nothing else depends on the new versions.


Deliverable: dependencies patched, the audit job moved into the root workflow so
it actually gates PRs, baseline updated to the real post-patch numbers, and the
accepted-advisories doc updated to explain each remaining finding.

Verification: `pnpm audit --audit-level=high` output, plus the full CI gate
(`lint:strict && typecheck && test && build`).

### 2. Block the SQL escapes and shrink the read-only role

`app/src/lib/security/validate-query.ts`, `app/drizzle/migrations/0019_readonly_revoke_internal_tables.sql`, `app/tests/unit/security/*`, `app/tests/integration/rls-isolation.test.ts`, `scripts/postgres/init-roles.sh`

**Status: done.**

- `DANGEROUS_DB_FUNCTIONS` (validate-query.ts:39-63) lists `pg_read_file`,
  `dblink`, `pg_sleep` and friends, but not `set_config` / `current_setting`.
  `set_config` is available to every role, so a user- or AI-authored statement
  can rewrite the `app.current_org_id` GUC — the GUC every tenant-scoped RLS
  policy reads through `app_current_org_id()` — and can set `role` on the
  customer\'s own database.
- `DML_DDL_KEYWORDS` (validate-query.ts:18-20) has no `INTO`, `COPY` or
  `PROGRAM`, so `SELECT * INTO evil FROM orders` passes validation and creates
  a table in the customer\'s database. This contradicts the T2 control
  ("bloquea DML/DDL").
- The `dashbi_readonly` role keeps `SELECT` on tenant tables the app never
  intends the AI to read. `scripts/postgres/init-roles.sh:96` grants
  `SELECT ON ALL TABLES IN SCHEMA public`, and migration 0017 revokes it only
  from 10 tables. `dashboards`, `dashboard_versions`, `llm_usage`,
  `nlqa_conversations`, `nlqa_messages`, `scheduled_reports`,
  `scheduled_report_runs`, `alert_events` and `uploaded_files` stay readable.
  The spreadsheet connector executes user/AI SQL against this role
  (`connectors/implementations/spreadsheet.ts:174`).

**What was done**

- The shared blocklist gained `set_config`, `current_setting`,
  `pg_terminate_backend`, `pg_cancel_backend`, `INTO`, `COPY` and `PROGRAM`.
- The three hand-rolled copies of the leading-keyword / semicolon /
  forbidden-pattern checks collapsed into one `assertSafeSqlStatement(sql,
  extraKeywords)` helper, called by every SQL-backed branch — postgres, mysql,
  hubspot, snowflake, spreadsheet/csv/excel and **shopify**, which previously
  checked only the leading keyword and had no blocklist and no multi-statement
  check. The blocklist can no longer drift per connector.
- Migration `0019_readonly_revoke_internal_tables.sql` revokes `ALL` on the
  nine internal `public` tables from `dashbi_readonly`, idempotently, skipping
  cleanly when the role or a table is absent.
- The DEFAULT PRIVILEGE hole is closed too, and it was the reason the
  migration alone was not enough: the bootstrap granted the read-only role
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES`, so every
  internal table created *after* 0019 would have been readable again. The
  bootstrap no longer grants it (`scripts/postgres/init-roles.sh`,
  `app/tests/integration/postgres.ts`) and 0019 revokes the one existing
  installations already have.
- `assertRolePermissions`, `normalizeSqlLimit` and the purity contract of
  `validateQuery` are untouched.

**Scope check done before implementing** — revoking the read-only role\'s
access to `public` is safe because the role is used in exactly three places,
all against the per-org upload schemas (`org_<uuid>`), never against the
internal tables: `spreadsheet.ts:103`, `spreadsheet.ts:173`,
`alerts/evaluator.ts:102`. The `uploaded_files` row is read through
`withOrgContext` (app role). The per-org upload tables get their grant
explicitly, per table, in `buildReadOnlyGrantsSQL` on every upload commit.

**Not fixed** — the read-only role still has `USAGE` on schema `public`; it
cannot read anything there, and revoking `USAGE` would break the per-org
schema resolution path.

**Evidence**

- Unit: `pnpm vitest run tests/unit/security/readonly-role-grants.test.ts tests/unit/security/validate-query-blocked-statements.test.ts` → `Test Files 2 passed (2)`, `Tests 100 passed (100)`
- Integration: `pnpm vitest run tests/integration/rls-isolation.test.ts` → `Test Files 1 passed (1)`, `Tests 8 passed (8)`, including the two 0019 tests
- Mutation check: removing the default-privilege revoke from the migration makes the new integration test fail (`expected 0, got 1` at the `countDefaultGrants()` assertion) and restoring it makes it pass again — the test has real regression power, not a vacuous assertion
- Real database check (throwaway `postgres:16-alpine`): before 0019 the default ACL was `{dashbi_readonly=r/postgres}` and `dashboards` was selectable; after 0019 the default ACL is gone, `dashboards` is not selectable, and **a table created after the migration is not selectable either**; a second run of 0019 is a no-op
- Full gate: `pnpm lint:strict` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (`Test Files 159 passed (159)`, `Tests 1899 passed (1899)`, 0 failed, 0 skipped), `pnpm build` exit 0
- Rollback boundary: the task commit removes the blocklist additions, the `assertSafeSqlStatement` helper, migration 0019, the journal entry, the two new test files and the two test edits. No runtime code depends on any of it beyond the stricter validation.

### 3. Normalize hosts before the SSRF blocklist

`app/src/lib/security/validate-connection.ts`, `app/tests/security/ssrf.test.ts`

**Status: done.**

- `validatePostgresHost` (validate-connection.ts:29) matches the host string
  literally. The normalizers already exist in the same file —
  `parseIpv4Literal` (line 104) and `isPrivateIpv6` (line 160) — but only
  `validateOutboundUrl` (line 190) uses them.
- Live bypasses today: `127.1`, `2130706433`, `0177.0.0.1`, `0x7f.0.0.1`,
  `[::1]`, `fd00::1`, `fe80::1`, `localhost:3000`, `127.0.0.1:5432`,
  `redis`, `db.internal`, `user:pass@10.0.0.5`.
- The threat model marks "[x] `2130706433` no evada el bloqueo" and prints
  IPv6 regexes that do not exist in the code. Consumers: `postgres.ts:70`,
  `mysql.ts:60`, `snowflake.ts:61`, `shopify.ts:28`.

**What was done**

- A new `normalizeHostInput` canonicalizes the host before any comparison:
  URL form → hostname, `user:pass@` prefix, path, trailing dot of a fully
  qualified name, IPv6 brackets, and the `:port` suffix (stripped only when
  the value holds exactly one colon, so bare IPv6 survives).
- `validatePostgresHost` now rejects on five independent nets, each evaluated
  against both the normalized host and the effective address: the exact-name
  sets, `isPrivateIpv4`, the existing `PRIVATE_IP_PATTERNS` regexes,
  `isPrivateIpv6`, and internal service names (a conservative exact-name list
  plus the `.internal` / `.local` / `.localhost` / `.localdomain` suffixes).
- **`parseIpv4Literal` had a bug of its own**: the last inet_aton group was
  shifted by 8 bits too many, so `2130706433` parsed as `1.0.0.0` and `127.1`
  as `127.0.1.0` — neither of them is loopback, so the normalizer reported
  them as public. Fixed: the last group now covers the remaining low-order
  bytes, matching the `inet_aton` semantics the resolver actually applies.
  The HTTP path was not exposed to it (`new URL()` canonicalizes IPv4 before
  the helper sees it), but the helper was wrong.
- Single-label hostnames are NOT rejected: `validatePostgresHost` also
  validates Snowflake account identifiers (`snowflake.ts:61`), which are
  legitimately labels without a dot. That trade-off is documented in the code.

**Not fixed** — DNS rebinding (public at validation time, private at connect
time) remains open in both paths. Closing it needs the resolved address
pinned at connect time, which is a separate change. The scope note in the
file says so explicitly.

**Evidence**

- Unit: `pnpm vitest run tests/security/ssrf.test.ts` → RED before the fix `Tests 15 failed | 26 passed (41)`, GREEN after `Test Files 1 passed (1)`, `Tests 50 passed (50)`
- Security suite: `pnpm vitest run tests/security` → `Test Files 8 passed (8)`, `Tests 176 passed (176)`
- Normalizer probed directly: `2130706433`, `127.1`, `0177.0.0.1`, `0x7f.0.0.1` all resolve to `127.0.0.1`; `192.168.257` → `192.168.1.1`; `8.8.8.8` unchanged
- `validateOutboundUrl` proven unchanged: the function body is byte-identical to HEAD, and a differential harness over 38 URLs (inet_aton forms, RFC1918, link-local, IPv6, metadata hosts, public hosts, `file://`/`gopher://`) reports 0 divergences in outcome or error message
- Full gate: `pnpm lint:strict` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (`Test Files 159 passed (159)`, `Tests 1940 passed (1940)`, 0 failed, 0 skipped), `pnpm build` exit 0
- One intentional de-block: `16777343` is now ALLOWED, because the correct `inet_aton` value is `1.0.0.127` (public) and the broken parse used to call it `127.0.0.0`
- Rollback boundary: the task commit restores the string-level comparison and the old `parseIpv4Literal`. Nothing else depends on the new helper.

### 4. Stop leaking driver internals to the client

`app/src/app/api/data-sources/[id]/test/route.ts`, `app/src/app/api/nlqa/ask/route.ts`, `app/src/lib/redact.ts`, `app/tests/unit/api/error-contract-leaks.test.ts`, `app/tests/unit/redact.test.ts`

**Status: done.**

- `data-sources/[id]/test/route.ts:31` returns `NextResponse.json(result)`
  where `result.error` is the raw driver message
  (`postgres.ts:88`: `password authentication failed for user "dashbi_readonly"`,
  `getaddrinfo ENOTFOUND db.internal`). `errorResponse` sanitizes *thrown*
  errors only — a returned error bypasses it entirely. The route's own comment
  documents this exact leak class and closes only the catch path.
- `datasource.view` includes `viewer`, so any read-only member can harvest
  internal hostnames and role names repeatedly.
- `nlqa/ask/route.ts:246` returns `execErr.message` verbatim on the execution
  path, while the adjacent `ValidationError` branch is sanitized.

**What was done**

- The connector-test route distinguishes a RESOLVED failure from a success:
  failure now answers `{ ok: false, error: 'connection_failed', message:
  <curated Spanish>, latencyMs }` and the raw driver text stays server-side,
  logged with `redactError` and the data-source / org / user context. The
  success shape and the rate-limit branch are unchanged. The client reads
  `data?.message ?? data?.error`, so the curated message is what the UI shows
  and no client change was needed.
- The NLQA execution branch answers with the same `{ error, message }` shape as
  its sibling `ValidationError` branch, with a curated message, and logs the
  reason redacted. The panel reads `errBody?.error`, so the machine code is
  preserved.
- `scrubUrlCredentials` was added to `@/lib/redact` and applied inside
  `redactError`, so the credentials embedded in a connection string
  (`postgresql://user:pass@host/db`) are scrubbed from every redacted error.
  `redactSecrets` scrubs API keys, not URL credentials: a short password does
  not match the generic 40+ character pattern.

**Evidence**

- Unit: `pnpm vitest run tests/unit/redact.test.ts tests/unit/api/error-contract-leaks.test.ts tests/unit/redact-error.test.ts` → `Test Files 3 passed (3)`, `Tests 41 passed (41)`
- The new leak tests went RED first (`Tests 5 failed | 4 passed (9)`) with the response bodies showing the raw driver text, and GREEN after (`Tests 11 passed (11)`)
- Mutation check: removing the credential scrub makes "keeps a password-bearing DSN out of the log" fail; restoring it returns the file to green
- Full gate: `pnpm lint:strict` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (`Test Files 159 passed (159)`, `Tests 1951 passed (1951)`, 0 failed, 0 skipped), `pnpm build` exit 0
- Rollback boundary: the task commit restores the raw-error responses and removes `scrubUrlCredentials`. The connector layer was not touched, so the connector tests keep their current expectations.

### 5. Make rate limits unspoofable and actually per-org

`app/src/lib/http/client-ip.ts` (new), `app/src/lib/rate-limit.ts`, `app/src/lib/middleware/rate-limit.ts`, `app/src/app/api/**/route.ts`, `app/src/lib/auth/permissions.ts`, `app/tests/unit/**`

**Status: part A done (IP helper + per-org buckets + the viewer/export fix).
Part B — the routes that had NO limit at all — is still open; see below.**

- Nine call sites read `x-forwarded-for.split(',')[0]`
  (`nlqa/ask:31`, `dashboards/generate:30`, `files/upload:90`, `data-sources:107`,
  `data-sources/[id]/test:14`, `alert-rules/[id]/test-channel:41`,
  `widgets/explain:31`, `middleware/rate-limit.ts:21`, `audit/log.ts:66`).
  `deploy/nginx/dash-bi.conf:60` sets `proxy_set_header X-Forwarded-For
  $proxy_add_x_forwarded_for`, which appends the real peer at the END of the
  list — so the first hop is the client-controlled one. Every IP bucket is
  bypassed by rotating the header, and the forged value is what
  `audit_log.ip` records.
- Several buckets are keyed `org:${orgId}:ip:${ip}` in one string
  (`nlqa-ask`, `widget-explain`, `ds-create`, `ds-test`, `file-upload`), so the
  effective limit scales with the number of members. `dashboards/generate` and
  `alert-rules/[id]/test-channel` already used two separate buckets — that is
  the pattern to copy.
- No rate limit at all: `dashboards/[id]/export/pdf` (POST), `files/commit`
  (DDL + bulk insert), `dashboards/[id]/share`, `dashboards/[id]/embed`,
  `scheduled-reports` (POST), `organizations/members` (POST),
  `organizations/llm-key` (PUT/DELETE).
- `export.pdf` is granted to `viewer`, so a read-only account can enqueue
  unbounded Puppeteer renders against a worker whose BullMQ limiter is global
  (one tenant starves the others).
- `withRateLimit` / `rateLimitByOrgAndIp` in `lib/middleware/rate-limit.ts` have
  zero call sites: the module advertises a wrapper that protects nothing.

**Part A — what was done**

- New `app/src/lib/http/client-ip.ts` with `getClientIp(req)`: prefers
  `x-real-ip` (nginx overwrites it with `$remote_addr`, so it cannot be
  forged), otherwise the LAST hop of `x-forwarded-for` (the one the trusted
  proxy appended), otherwise `'unknown'`. All nine inline reads now call it,
  including the `audit_log.ip` write.
- The trust boundary is documented in the helper: it is only trustworthy
  behind the documented reverse proxy. The current docker-compose publishes
  the app directly, with no proxy, so there is no reliable client IP in that
  topology — which is exactly why the ORG bucket, not the IP bucket, is the
  guarantee the threat model asks for.
- The five routes that keyed one combined bucket now check TWO independent
  buckets (an org one and an IP one), with the same capacities and refill
  rates, and the 429 response carries the `scope` that failed —
  `dashboards/generate` and `alert-rules/[id]/test-channel` were the reference
  shape and were left untouched.
- `viewer` removed from the `export.pdf` permission.

**Known gap left by this part** — the export UI is not role-gated:
`src/components/dashboard/ExportShareDialog.tsx` and
`src/app/(dashboard)/dashboards/[id]/page.tsx` render the export affordance
without a role check, so a viewer now sees the button and gets a 403 from
`POST /api/dashboards/[id]/export/pdf`. Both files carry unrelated work in
flight and are off-limits for this feature, so the UI gate is a follow-up.

**Evidence (part A)**

- RED: `Tests 8 failed | 77 passed (85)` across the four touched test files,
  plus the missing-module error for the new helper — the failures were the
  expected assertions (first-hop IP, combined bucket, viewer export)
- GREEN: `Test Files 4 passed (4)`, `Tests 93 passed (93)`
- Mutation checks: flipping the helper back to the first hop → 4 targeted
  failures; restoring the combined `org:...:ip:...` key → 2 targeted
  failures; both reverted and re-verified green
- Full gate: `pnpm lint:strict` exit 0, `pnpm typecheck` exit 0, `pnpm test`
  exit 0 (`Test Files 160 passed (160)`, `Tests 1964 passed (1964)`, 0 failed,
  0 skipped), `pnpm build` exit 0
- Two test files outside the originally declared edit surfaces were updated
  (`tests/unit/auth/permissions.test.ts`, `tests/unit/audit/log.test.ts`):
  both asserted the behaviour this task ordered to change.

**Part B — what was done**

Seven routes had no limit at all. Each now carries the same two-bucket shape,
checked after `requireAuth` (an unauthenticated request consumes no bucket)
and before the work the route does:

| Route | Method | Org bucket | IP bucket |
|---|---|---|---|
| `dashboards/[id]/export/pdf` | POST | 10/min | 20/min |
| `files/commit` | POST | 10/min | 20/min |
| `dashboards/[id]/share` | POST | 20/hour | 50/hour |
| `dashboards/[id]/embed` | POST | 20/hour | 50/hour |
| `scheduled-reports` | POST | 10/hour | 20/hour |
| `organizations/members` | POST | 30/hour | 50/hour |
| `organizations/llm-key` | PUT, DELETE | 5/min | 10/min |

`app/src/lib/middleware/rate-limit.ts` was deleted: `withRateLimit` and
`rateLimitByOrgAndIp` had zero consumers repo-wide, and a module that
advertises a route wrapper which protects nothing is what makes a reviewer
believe the routes are covered.

**Invariant guard** — `tests/unit/api/route-rate-limits.test.ts` scans the
route sources under `app/src/app/api/**` for the routes that reach an LLM, an
outbound HTTP call, a credential write, a PDF export, a bulk DDL, an account
creation or a recurring export job, and fails if any of them lacks a rate
limit. The list of 13 sensitive routes is pinned in the test, so the next
route that reaches one of those effects has to be given a limit or the test
has to be updated deliberately. This is intentionally loud.

**Test coupling fixed** — `tests/unit/api/llm-key-byok.test.ts` was hitting
the real in-memory limiter, so six requests in that file shared one org
bucket and the last one would have been rejected with a 429 for a reason
unrelated to what the file asserts. It now mocks `@/lib/rate-limit`, and the
llm-key check went back to the canonical position (right after `requireAuth`,
before the body is parsed) instead of being moved to accommodate the test.

**Evidence (part B)**

- RED: `pnpm vitest run tests/unit/api/route-rate-limits.test.ts` → `Tests 47 failed | 25 passed (72)`, with the failures naming the seven routes that "declare no rate limit"
- GREEN: `Test Files 1 passed (1)`, `Tests 72 passed (72)`
- Mutation checks on `export/pdf`: rewriting the org key to the old combined shape → 2 failures; rewriting the IP key to a per-org IP bucket → 2 failures; both reverted and re-verified green
- Full gate: `pnpm lint:strict` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (`Test Files 161 passed (161)`, `Tests 2036 passed (2036)`, 0 failed, 0 skipped), `pnpm build` exit 0

### 6. Stop shipping SQL to anonymous visitors and actually emit the embed CSP

`app/src/lib/sharing/get-public-dashboard.ts`, `app/src/lib/embed/get-embed-dashboard.ts`, `app/src/middleware.ts`, `app/src/lib/embed/token.ts`, `deploy/nginx/dash-bi.conf`, `app/tests/unit/api/dashboard-{share,embed}.test.ts`

**Status: done.**

- `get-public-dashboard.ts:87` returns `dashboard.widgets` verbatim. Stored
  widgets carry `source.query.sql` and `source.dataSourceId`
  (`lib/widgets/validator.ts:269` accepts `source.query` as unknown), so the
  RSC payload of a public link — or of an embed — handed an anonymous visitor
  the tenant's table names, join logic and business filters.
  `get-embed-dashboard.ts:100` did the same.
- `getCspFrameAncestors` (embed/token.ts:203-225) computes a correct
  `frame-ancestors` list, and `get-embed-dashboard.ts:77` passes it on as
  `config.cspHeader` — consumed only as a client-side prop
  (`DashboardEmbedView.tsx:12`) and never set as a response header.
  `next.config.ts` excludes `/embed/` from `X-Frame-Options: DENY` and adds no
  CSP for it, so the embed route had no browser-side framing restriction.
- `deploy/nginx/dash-bi.conf:38,41` sets `X-Frame-Options SAMEORIGIN` and a
  global CSP with `frame-ancestors 'none'` for every path — in the documented
  deployment that blocks every embed, legitimate ones included.

**What was done**

- One shared helper, `stripWidgetSources` (exported from the sharing module
  and consumed by the embed module — the sharing module does not import the
  embed module, so there is no cycle), removes `source` from every widget on
  both public paths. Everything else is kept: the renderer reads
  `widget.data`, and no component of the render path touches `source`
  (verified against `WidgetRenderer.tsx` and the widget components), so the
  dashboard still draws. The internals that remain (`orgId`, the dashboard
  `id`, `config.columns[].key`) are deliberate: the read-only view components
  require them and they expose no schema and no credential.
- The middleware emits the header now: it verifies the embed token and sets
  `Content-Security-Policy: frame-ancestors <the token's own allowed
  origins>` on `/embed/*` responses, degrading to `frame-ancestors 'none'`
  when the token cannot be verified — never to a permissive value. It only
  sets the header; it never rejects the request. `cspHeader` stays in the
  payload, because `DashboardEmbedView` consumes it as an optional prop.
- The middleware matcher gained `/embed/:path*`: the token is
  `emb_<payload>.<signature>`, so it contains a dot and the original matcher
  treated the path as "a file with an extension" and skipped it. Without this
  entry the middleware never ran for an embed and the header was never
  emitted.
- The nginx drop-in carves out `/embed/`: no blanket `X-Frame-Options` (an
  empty value makes nginx emit no header) and no global `frame-ancestors`,
  because a browser applies EVERY CSP it receives and a global `'none'` from
  nginx would neutralise the per-token header. The other security headers
  are re-declared in that block, since nginx does not inherit `add_header`
  into a location that defines its own.

**Behaviour change to be aware of** — the middleware moved from the Edge
runtime to the Node runtime. It is required: the token HMAC reads
`EMBED_TOKEN_SECRET` from the environment, the Edge runtime inlines
`process.env` at BUILD time, and the Docker build carries no secret (verified:
the Dockerfile defines no secret, they arrive at runtime through
docker-compose). On Edge every verification would have failed and every
embed would have fallen back to `frame-ancestors 'none'` — that is, all
embeds blocked. The cost is one HMAC per embed request plus the Node runtime
for the middleware as a whole.

**Deliberately not changed** — the server-side Origin check still passes
when the request carries no `Origin`/`Referer`, and the API's default
`allowedOrigins` is still `['*']`. Failing closed there would break the embed
page for a normal top-level navigation (a browser sends no `Origin` on a
top-level GET), and changing the default would break embeds that were minted
without an explicit list. The browser-side `frame-ancestors` header is now
the enforcement, and the residual gap is documented in `token.ts`.

**Evidence**

- RED: `pnpm vitest run tests/unit/api/dashboard-share.test.ts tests/unit/api/dashboard-embed.test.ts` → `Tests 5 failed | 15 passed (20)`, with the raw `SELECT sum(total)` and the data-source id visible in the payloads and the CSP header `null`
- GREEN: same command → `Test Files 2 passed (2)`, `Tests 20 passed (20)`
- End-to-end against `next start`: forged token → `frame-ancestors 'none';` (HTTP 200, not rejected); valid token + allowed origin → `frame-ancestors https://portal.client.com;`; valid token + disallowed origin → `frame-ancestors 'none';`; `/share/*` and `/login` get no CSP from the middleware
- The build output confirms the middleware runs on the Node runtime with both matchers, and that `EMBED_TOKEN_SECRET` stays a runtime read instead of being inlined
- Full gate: `pnpm lint:strict` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (`Test Files 161 passed (161)`, `Tests 2044 passed (2044)`, 0 failed, 0 skipped), `pnpm build` exit 0
- Rollback boundary: the task commit restores the verbatim widget payloads, the middleware without the CSP block, and the nginx server-level headers for every path.

### 7. Realign the threat model with the code

`docs/security/threat-model.md`, `specs/deployment.md`, `specs/embed-mode.md`

**Status: done.**

Every checkbox in this feature that was `[x]` while unimplemented gets
corrected, and each one that this feature actually implements gets a pointer to
the enforcing code and the test that locks it.

**What was done**

- `docs/security/threat-model.md` went from v0.2 to v0.3. Every `[x]` now
  carries two pointers: the file that enforces the control and the test that
  locks it. Every unimplemented control is `[ ]` and says what is missing and
  where the gap lives. The T3 section no longer prints IPv6 regexes that do
  not exist in the code — it describes what `validate-connection.ts` actually
  does. The duplicated pre-implementation checklist was de-duplicated and
  given the same evidence.
- A new section 0 records, per control, the commit that made it true, so the
  history of the drift is visible instead of invisible.
- `specs/deployment.md` publishes the nginx configuration that actually ships
  (the `/embed/` carve-out, the per-token CSP, no `/pdf-internal` proxy).
- `specs/embed-mode.md` marks the `frame-ancestors` criterion as implemented
  and points at the code that emits it.

**Controls demoted from `[x]` to `[ ]` because no code enforced them**

T1 "audit log de cada query ejecutada" · T2 "la IA nunca recibe prompts de SQL
previos" (the NLQA history does carry the previously generated SQL) · T3 "test
connection antes de guardar" (the POST persists without connecting) · T4
"master key rotable sin downtime" and "audit log de cada lectura de key" ·
T5 "circuit breaker", "alerta en UI", "límites por plan", "budget diario" ·
T6 "rate limit por IP en links públicos", "view counter + alerta", "expiración
por defecto en embed" and "revocación de embed" · T7 "validación client-side",
"revertir en cliente" y "try/catch por widget" · T8 "worker sin DB compartida",
"`--no-sandbox` solo si es necesario" y "block de dominios internos" · C1
"redacción recursiva", "no loguear SQL completo" y "no loguear tokens de un
uso" · C2 "eventos de auth", "datasource tested", "eventos BYOK" y el guard
`assertSafeMetadata` (que sale temprano en producción) · C4 "restore drill
probado" · C5 "Renovate" y "SBOM".

**Controls promoted to `[x]` because the code does enforce them**

`robots.txt` (`app/public/robots.txt`, trackeado desde `b80417a`), the share
route's 30-day default expiry, and the C5 audit gate.

**Verification**

- A pointer-existence sweep over the three documents: 82 distinct
  repository-relative pointers, 0 missing. The only non-existent path is
  `app/.github/workflows/ci.yml`, cited on purpose as the place where the
  inert audit job used to live.
- The 19 cited test files all exist, and the four quoted test names were
  grepped and found verbatim.
- Markdown fence parity checked on all three files.
- Documentation only: no code changed, so the application gate is unchanged
  from the last task (lint, typecheck, 2044 tests, build all green at
  `1166895`).

## Out of scope (P1/P2, recorded, not fixed here)

- PDF worker isolation (separate service, no DB credentials, no master key) and
  Chrome sandbox flags.
- CSRF origin gate on the app's own mutating routes.
- Audit-event gaps: `auth.*` never emitted, `datasource.tested` never emitted,
  BYOK audited as `org.settings_updated`, `assertSafeMetadata` skipped in
  production, non-recursive `redactMetadata`.
- LLM budget: reserve-before-call, hourly circuit breaker, wire
  `evaluateLLMQuota` (currently referenced only by tests).
- Webhook headers stored unencrypted in `alert_rules.channels`.
- `readonlyDb` silently falling back to `postgresql://localhost:5432/dashbi`.
- Sheets connector trusting the model-supplied `spreadsheetId`.
- Upload size checked after buffering; no XLSX expansion cap; `parseStore`
  without TTL.
- Embed tokens without default expiry or revocation; origin check skipped when
  no `Origin`/`Referer` is present.
- `org_members` RLS policy permitting cross-org writes.
- Query cache key collision (`JSON.stringify` with an array replacer flattens
  nested `params`).
- `withOrgContext` 3-argument overload hard-coding `role='editor'` at 10 call
  sites.
- Onboarding page reading a client-supplied `x-user-id` header.
- Master key rotation path.

## Work-unit commits

One commit per task, Conventional Commits, tests and docs in the same commit as
the behavior they cover. All on `fix/security-p0-hardening`, based on `main`
at `e0ab4b3`.

| # | Task | Commit |
|---|---|---|
| 1 | Dependencies + audit gate | `20b029a` — `fix(deps): patch critical next and sentry advisories, enforce audit gate in CI` |
| 2 | SQL escapes + read-only role | `a7ce7ab` — `fix(security): block SQL escapes and revoke the read-only role from internal tables` |
| 3 | SSRF host normalization | `24da208` — `fix(security): normalize connection hosts before the SSRF blocklist` |
| 4 | Error sanitization | `eb18668` — `fix(security): stop returning raw driver errors to clients` |
| 5a | Client IP + per-org buckets | `b9eafd3` — `fix(security): make rate limits unspoofable and actually per-org` |
| 5b | The routes that had no limit | `d321b29` — `fix(security): rate limit the routes that had none` |
| 6 | Public payload + embed CSP | `15af258` — `fix(security): strip SQL from public payloads and enforce the embed CSP` |
| 7 | Threat model realignment | `ad6dd21` — `docs(security): realign the threat model with the code that exists` |
| — | Closing record | `55a6af2` — `docs(security): record the closing commit identity and the final gate` |
| — | Native review record | `3aa9615` — `docs(security): record the native review outcome for the P0 feature` |
| 8 | `better-auth` a la línea parcheada | `0375b6d` — `fix(deps): bump better-auth to 1.7.14 — clears an auth-bypass advisory` |

**Task 8 — `better-auth` a la línea parcheada.** La tarea no estaba prevista: apareció
cuando `main` avanzó con un bump a `better-auth` 1.6.x, que arrastra un advisory
**CRÍTICO** ("OAuth state can be used as a Magic Link to sign in as another user", más
"OAuth Proxy lets an attacker sign in as another user"). Esta app tiene magic link y
Google OAuth activos, así que el vector es alcanzable. `better-auth >= 1.7.7` parchea
los tres; el bump va a `^1.7.14`.

La línea 1.7 además valida el schema Drizzle contra los campos que escribe, y escribe
`user.image` — la columna que en este schema siempre fue `avatar_url`. El campo se
**mapea** (`user: { fields: { image: 'avatarUrl' } }`) en vez de agregar una columna
duplicada, así que el avatar del proveedor sigue landing donde el producto lo lee. Sin
el mapeo, `POST /api/auth/sign-up/email` responde 500 y el signup se rompe.

**Los hashes de esta tabla cambiaron**: `main` avanzó con 2 commits durante el trabajo y
la branch se rebasó encima, así que los identificadores de los commits anteriores a ese
rebase (`f124818`, `7ce0baf`, `b21bb58`, `811482e`, `2cbbf50`, `6598792`, `1166895`,
`f0dcaa2`, `bfc7b19`, `d27dc2a`) ya no existen en la branch. Los de arriba son los
actuales.

## Status

All eight tasks are done. The feature is open as PR #18
(`fix/security-p0-hardening` → `main`), CI en verde: `Dependency audit (baseline
gate)`, `Lint, typecheck, test, build` y `Playwright E2E`. El merge sigue siendo
decisión del usuario, igual que los hallazgos P1/P2 listados arriba.

### Verification of the final state

`pnpm lint:strict` exit 0 · `pnpm typecheck` exit 0 · `pnpm test` exit 0
(161 files, 2044 tests, 0 failed, 0 skipped, integration included against a
real Postgres) · `pnpm build` exit 0 · `pnpm audit:check` exit 0
(`critical 0/0, high 4/4`).

The unrelated work that was already in the working tree when this feature
started (41 modified files, 16 untracked) was never staged, edited or
committed: every commit in this feature names its files explicitly.

The CI run that gates PR #18 is green on all three jobs, including the
Playwright one across the three browser engines — the webkit engine could not
run locally because the host lacks `libicu74`/`libxml2`/`libflite1` and `sudo`
was not available, so that engine is covered by CI evidence only.

### Native review

The native review (receipt-driven development) ran on this candidate and
closed **approved**, with 11 non-blocking findings, all of them informational
and none of them opening a correction.

What it actually reviewed is worth stating plainly: the native candidate is
the `current-changes:workspace` projection, which freezes the working-tree
diff — and this repository carried 41 modified files of unrelated UI work
that were never part of this feature. Every one of the 11 findings points at
that unrelated work (`Header.tsx`, `Sidebar.tsx`, `DemoDashboardViewer.tsx`,
`dashboards/page.tsx`, `NlqaPanel.tsx`, `HighDensityChart.tsx`). None of them
is about this feature, and none of them was actioned here: they belong to
the work they come from.

A committed range could not be submitted instead: the route the facade
offers pins the workspace projection, and starting with a `baseRef` was
refused as a retained-selection/candidate mismatch.
