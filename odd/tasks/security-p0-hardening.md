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

`app/src/app/api/data-sources/[id]/test/route.ts`, `app/src/app/api/nlqa/ask/route.ts`, `app/src/lib/connectors/implementations/*.ts`, `app/tests/unit/api/*`

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

Deliverable: both routes return a fixed, curated error string to the client and
keep the detail server-side in the log (redacted).

### 5. Make rate limits unspoofable and actually per-org

`app/src/lib/http/client-ip.ts` (new), `app/src/lib/rate-limit.ts`, `app/src/lib/middleware/rate-limit.ts`, `app/src/app/api/**/route.ts`, `app/src/lib/auth/permissions.ts`, `app/tests/unit/**`

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
  `alert-rules/[id]/test-channel` already use two separate buckets — that is the
  pattern to copy.
- No rate limit at all: `dashboards/[id]/export/pdf` (POST), `files/commit`
  (DDL + bulk insert), `dashboards/[id]/share`, `dashboards/[id]/embed`,
  `scheduled-reports` (POST), `organizations/members` (POST),
  `organizations/llm-key` (PUT/DELETE).
- `export.pdf` is granted to `viewer`, so a read-only account can enqueue
  unbounded Puppeteer renders against a worker whose BullMQ limiter is global
  (one tenant starves the others).
- `withRateLimit` / `rateLimitByOrgAndIp` in `lib/middleware/rate-limit.ts` have
  zero call sites: the module advertises a wrapper that protects nothing.

Deliverable: one shared `getClientIp` helper that reads the right-most
trusted hop, two independent buckets (org, IP) on every limited route, the
missing limits added, `viewer` removed from `export.pdf`, and the unused
wrapper either wired up or deleted.

### 6. Stop shipping SQL to anonymous visitors and actually emit the embed CSP

`app/src/lib/sharing/get-public-dashboard.ts`, `app/src/lib/embed/get-embed-dashboard.ts`, `app/src/app/embed/[token]/page.tsx`, `app/src/lib/embed/token.ts`, `deploy/nginx/dash-bi.conf`, `app/tests/unit/**`

- `get-public-dashboard.ts:87` returns `dashboard.widgets` verbatim. Stored
  widgets carry `source.query.sql` and `source.dataSourceId`
  (`lib/widgets/validator.ts:269` accepts `source.query` as unknown), so the
  RSC payload of a public link hands an anonymous visitor the tenant's table
  names, join logic and business filters. `get-embed-dashboard.ts:100` does the
  same for embeds.
- `getCspFrameAncestors` (embed/token.ts:203-225) computes a correct
  `frame-ancestors` list, and `get-embed-dashboard.ts:77` passes it on as
  `config.cspHeader` — which is consumed only as a client-side prop
  (`DashboardEmbedView.tsx:12`) and never set as a response header.
  `next.config.ts` excludes `/embed/` from `X-Frame-Options` but emits no CSP
  for it, so the embed route has no browser-side framing restriction.
- `deploy/nginx/dash-bi.conf:38,41` sets `X-Frame-Options SAMEORIGIN` and a
  global CSP with `frame-ancestors 'none'` for every path, which — in the
  documented deployment — blocks every embed, legitimate ones included.

Deliverable: the public and embed payloads strip `source` from every widget;
the embed route emits a `Content-Security-Policy` header with the token's
`frame-ancestors`; the nginx drop-in stops blanket-framing `/embed/` while
keeping `X-Frame-Options: DENY` everywhere else.

Note: `DashboardEmbedView.tsx` and `DashboardPublicView.tsx` are already
modified by unrelated work in the working tree — the fix is scoped to the
server-side payload and the route, so those components are not touched.

### 7. Realign the threat model with the code

`docs/security/threat-model.md`, `docs/security/accepted-advisories.md`

Every checkbox in this feature that was `[x]` while unimplemented gets
corrected, and each one that this feature actually implements gets a pointer to
the enforcing code and its test. The threat model is the document future work
reads to decide what is safe; leaving it lying is how the next audit finds the
same gaps.

Deliverable: an accurate threat model, with the evidence (file + test) next to
each control.

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
the behavior they cover.

| # | Task | Commit message (planned) |
|---|---|---|
| 1 | Dependencies + audit gate | `fix(deps): patch critical next and sentry advisories, enforce audit gate in CI` |
| 2 | SQL escapes + read-only role | `fix(security): block set_config and DML escapes in SQL validation` |
| 3 | SSRF host normalization | `fix(security): normalize connection hosts before the SSRF blocklist` |
| 4 | Error sanitization | `fix(security): stop returning raw driver errors to clients` |
| 5 | Rate limiting | `fix(security): make rate limits unspoofable and per-org` |
| 6 | Public payload + embed CSP | `fix(security): strip SQL from public payloads and enforce embed CSP` |
| 7 | Threat model realignment | `docs(security): realign threat model controls with the implemented reality` |
