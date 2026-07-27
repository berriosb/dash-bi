---
name: security-audit
description: Use when the user asks for a security review, vulnerability check, audit of a file or feature, before merging auth/multi-tenant/AI-gateway code, after pulling new dependencies, or when implementing anything touching database queries, authentication, BYOK encryption, or AI-generated SQL. Triggers on phrases like "audit security", "security review", "is this safe", "revisa seguridad", "auditá esto", or implicit security concerns. Not a substitute for real penetration testing — this is a focused static review tailored to dash-bi's threat model (multi-tenant data isolation, SQL injection through AI-generated queries, secrets in logs, BYOK encryption). Not for general code quality, performance, or UX.
user-invocable: true
argument-hint: "[file|feature|repo] [path]"
license: AGPL-3.0
version: 1.0.0
---

This skill audits code against dash-bi's specific threat model documented in `docs/security/threat-model.md`. The threats are not generic OWASP — they are concrete failure modes for this product.

## Threat model (load from `docs/security/threat-model.md`)

The 10 controls (`T1`–`T10`) this skill verifies:

- **T1 — Tenant isolation**: every query to a tenant-scoped table goes through `withOrgContext(orgId, userId, fn)`. ESLint rule `no-raw-db-queries` (in `app/.eslint-rules/`) catches `db.select/insert/update/delete` outside `/app/api/` wrappers — but only in API routes. The agent must also scan `src/lib/`, `src/components/` server actions, and seed scripts.
- **T2 — RBAC**: every protected route calls `requirePermission(userId, orgId, 'resource.action')`.
- **T3 — SQL validation**: AI-generated SQL passes through `validateQuery()` from `app/src/lib/security/validate-query.ts` before reaching the DB. Direct `db.execute(sql)` without validation is a critical bypass.
- **T4 — BYOK encryption**: API keys encrypted with AES-256-GCM via `encryptApiKey`. Plaintext keys must never reach logs, errors, or JSON responses.
- **T5 — Log redaction**: Pino logger + `redactSecrets` applied. `console.log`/`console.error` are forbidden for any user-derived string that could contain a key.
- **T6 — SSRF on data sources**: connector configs validate host allowlist (`validatePostgresHost`) before opening connection.
- **T7 — Read-only DB user**: AI queries use a separate read-only Postgres role.
- **T8 — Error responses**: never echo `error.message` to client for internal errors (info leak). Wrap with `toUserError`.
- **T9 — Rate limiting**: routes that touch external APIs (AI gateway, connectors) implement rate limits.
- **T10 — Audit log completeness**: sensitive actions call `audit(orgId, userId, action, target)`.

## How to audit

1. **Load context**: read `docs/security/threat-model.md`, `app/src/db/schema.ts` (to know which tables are tenant-scoped), `app/src/lib/auth/context.ts` (RBAC matrix), `app/src/lib/security/validate-query.ts`.
2. **Scope the target**:
   - Single file → audit just that file with full depth.
   - Feature or area (e.g., "AI gateway", "auth flow") → walk through all touched files.
   - Repo-wide sweep → run all 10 controls across `app/src/`.
3. **Walk the 10 controls** against the target. Use `grep -n` (via `rg`) to find patterns; read the surrounding code to confirm context. Never flag without verifying the pattern is actually a violation (e.g., `db.select()` inside a `withOrgContext` callback is fine).
4. **Report** findings in the format below. Be specific: file path, line number, snippet, why it's a problem, suggested fix.

## Output format

For each finding, output:

```
### [SEVERITY] T# — short title

- **Where:** `app/path/to/file.ts:LINE`
- **Pattern:** the offending line or 2-3 line snippet
- **Risk:** plain-language consequence
- **Fix:** concrete code change (paste the corrected snippet when possible)

Severity levels:
- **CRITICAL** — data leak, auth bypass, secret exposure. Block merge.
- **HIGH** — defense-in-depth gap, easy exploit path. Fix before release.
- **MEDIUM** — code smell that could become a vuln with future changes. Fix in same sprint.
- **LOW** — informational, doc gap, or stylistic.
```

End with a **summary table**:

| Severity | Count | Controls touched |
|---|---|---|

And a **verdict**: `PASS` (no HIGH/CRITICAL), `PASS-WITH-NOTES` (only MEDIUM/LOW), `FAIL` (any HIGH or CRITICAL).

## Checks by control

### T1 — Tenant isolation

```bash
# Find db.select outside withOrgContext (ESLint should already catch these in /app/api)
rg -n "db\.(select|insert|update|delete)" app/src/lib app/src/components app/src/db --type ts

# Find direct queries on tenant-scoped tables
rg -n "from (dashboards|dataSources|queries|llmUsage|auditLog|orgMembers|publicLinks)" app/src --type ts -B2 -A2

# Find db.execute with raw SQL
rg -n "db\.execute\(" app/src --type ts
```

A query is safe IF it's inside a `withOrgContext(...)` callback, OR the table is global (no `org_id` in schema), OR the call is in a migration / seed.

### T2 — RBAC

```bash
# Find protected routes without requirePermission
rg -n "export async function (POST|PATCH|PUT|DELETE)" app/src/app/api --type ts -A10 | rg -L "requirePermission"
```

Every non-GET route that touches tenant-scoped data MUST call `requirePermission`. GET routes call it too unless explicitly public.

### T3 — SQL validation

```bash
# AI-generated SQL must pass through validateQuery
rg -n "kind: 'sql'" app/src/lib/ai --type ts -B3 -A3

# Direct SQL execution without validation
rg -n "db\.execute\(" app/src --type ts
```

The flow MUST be: AI generates SQL → `validateQuery(sql)` → `db.execute(validatedSql)` with the read-only user. Bypassing `validateQuery` is critical.

### T4 — BYOK encryption

```bash
# Plaintext keys in code
rg -n "(sk_live|sk_test|sk-proj|AIza|sk-ant-)[a-zA-Z0-9]+" app/src --type ts

# decryptApiKey output leaking to response
rg -n "decryptApiKey" app/src --type ts -A5

# Any string concatenation with config that includes keys
rg -n "JSON\.stringify\(config" app/src --type ts
```

Decrypted keys must NEVER appear in: API responses, logs, error messages, audit log payloads, or query strings.

### T5 — Log redaction

```bash
# console.log/error in src/ (forbidden)
rg -n "console\.(log|error|warn)" app/src --type ts

# Pino logger without redact config
rg -n "pino\(" app/src --type ts -A5

# Stringified objects that may include secrets
rg -n "JSON\.stringify\(" app/src --type ts
```

Every `console.*` should be replaced with the project's Pino logger. Pino must be configured with `redact: ['*.apiKey', '*.configEncrypted', ...]`.

### T6 — SSRF

```bash
# Connector construction without host validation
rg -n "new (Client|Pool|Connection)" app/src/lib/connectors --type ts -B5
```

Every Postgres/Stripe/etc connector must call `validatePostgresHost()` or equivalent before opening the connection.

### T7 — Read-only DB user

```bash
# Queries that should use the read-only user
rg -n "executeQuery|hydrateDashboard" app/src/lib/query-engine --type ts -B3
```

The query engine uses a separate `DATABASE_READONLY_URL` connection. Hydration paths must use this connection, never the main `DATABASE_URL`.

### T8 — Error responses

```bash
# Returning raw error.message to client
rg -n "Response\.json\(\{ error:.*message" app/src/app/api --type ts

# Stack traces in responses
rg -n "error\.stack" app/src --type ts
```

Internal errors must use `toUserError(err)` from `app/src/lib/errors/`. Raw `err.message` leaks implementation details.

### T9 — Rate limiting

```bash
# AI/connector routes without rate limit
rg -n "export async function POST" app/src/app/api/dashboards/generate app/src/app/api/data-sources --type ts -A15
```

Routes hitting external APIs need a rate limiter middleware. Check that:
- `app/src/app/api/dashboards/generate/route.ts` has rate limit (per org + per IP).
- `app/src/app/api/data-sources/route.ts` POST has rate limit.

### T10 — Audit log

```bash
# Sensitive actions without audit log
rg -n "await requirePermission" app/src/app/api --type ts -A15 | rg -L "audit\("
```

Every state-mutating action must call `audit(orgId, userId, action, target)` on success. Misses are MEDIUM (compliance gap) but should be fixed.

## When NOT to use this skill

- Performance review → use a different audit skill or manual.
- UX/accessibility → use `impeccable`.
- General code review → just read the code.
- The user wants to write a new feature → this skill is for review only, not creation.

## Output verbosity

- Single-file audit: full detail on each finding, fix snippet included.
- Repo-wide sweep: summary table + critical findings only. Skip LOW unless user asks for verbose.
- "Quick check" → just say PASS or FAIL + which controls had findings, no per-finding detail.

## Agent

A specialized agent for this audit lives at `.agents/skills/security-audit/agents/security_auditor.toml`. Invoke it directly when you want a focused walk-through of one control or area instead of a manual sweep.