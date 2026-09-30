# Fix: propagate role and close the PII filter bypasses (CRITICAL-3, HIGH-1)

**Branch:** `fix/cross-tenant-isolation` (continues the previous feature)
**Source audit:** `docs/audits/2026-09-30-code-audit/CODIGO-AUDIT.md`
**Status:** in progress

## Context

`assertRolePermissions` never runs in production, and when it does run it can
be evaded by naming convention. Both were verified by reading the full call
chain before writing any code.

`assertRolePermissions` (`app/src/lib/security/validate-query.ts:200`) only
blocks PII columns for `role === 'viewer'`, and only `validateQuery` calls it,
guarded by `if (role)`. `ExecuteOptions.role` (`execute.ts:35-49`) is the only
source of that role and no caller supplies it. Result: `grep -rn
"assertRolePermissions("` matches tests only.

The audit reported 40+ passing assertions in `tests/security/pii-filter.test.ts`
against a function production never calls. That remains true of the current
tests: they call `assertRolePermissions` directly. The new tests drive the
callers.

## Tasks

### 1. HIGH-1 — close the naming-convention and wildcard bypasses

`app/src/lib/security/validate-query.ts`

`SENSITIVE_COLUMN_PATTERN` (`:187`) uses `\b`, which does not create a boundary
between `_` and a word character, so every snake_case column evades it. Verified
by running the current regex:

```
SELECT user_password FROM users     -> PASA
SELECT customer_ssn FROM customers  -> PASA
SELECT billing_tax_id FROM invoices -> PASA
SELECT token_type FROM sessions     -> PASA
```

`WILDCARD_PROJECTION` (`:198`) requires the `*` to be preceded by `[\s,(]`, so
`SELECT/*x*/* FROM users` passes.

Replacements, both verified empirically before the change was delegated:

- Sensitive columns: swap `\b` for `(?<![A-Za-z0-9])` / `(?![A-Za-z0-9])` so an
  underscore is a valid boundary. Keeps `tokenizer` passing and `PASSWORD`
  blocking, and now blocks the four snake_case cases above.
- Wildcard: drop the lookahead regex. Mask aggregate stars
  (`count|sum|avg|min|max|array_agg|json_agg ( * )`) and reject if any `*`
  survives. A comment cannot hide a projection `*` — it can only add one — so
  this fails closed without needing a SQL comment stripper, which would be a
  fail-open hazard if it mishandled a string literal.

Accepted false positives, both blocking more rather than less: a column named
`password_reset_required_at` and the string literal `'x*password'` are now
rejected. `SELECT 2 * 3` was already rejected by the old pattern, so that is
not a regression.

Out of scope: resolving columns from `Connector.getSchema()` instead of regex.
`assertRolePermissions` is synchronous and the catalog is async, so that turns
the whole chain async. Documented as follow-up, not attempted here.

### 2. CRITICAL-3 — carry the role from the route to the validator

`app/src/lib/query-engine/dashboard.ts`, `app/src/lib/query-engine/execute.ts`,
`app/src/lib/query-engine/resolve.ts`, and the three call sites

The role is available and dropped twice on the dashboard path:

```
dashboards/[id]/route.ts:59   ctx = requireAuth(...)        ctx.role in scope
dashboards/[id]/route.ts:68   hydrateDashboard(orgId, userId, widgets)   no role
dashboard.ts:59               hydrateWidgetFromQuery(orgId, userId, w)   no role
dashboard.ts:35               resolveConnector(orgId, userId, id)        no role
dashboard.ts:36               executeWithTimeout(connector, id, query)  no role
execute.ts:74                 validateQuery(q, type, opts.role === undefined)
```

`nlqa/ask/route.ts:39` gets the same `ctx` and drops the role at `:201` (the
`validateQuery` call) and `:219-224` (the `executeWithTimeout` call).

Make the `role` parameter **required** on `hydrateDashboard` and
`hydrateWidgetFromQuery` so the compiler forces every future call site to supply
it, rather than repeating a bug that no test caught. `executeWithTimeout` and
`resolveConnector` already take an optional `role`; pass it instead of widening
their signatures.

All three `hydrateDashboard` callers (`dashboards/[id]/route.ts:68`,
`dashboards/generate/route.ts:150` and `:207`) have `ctx.role` in scope.

Note `dashboards/[id]/route.ts:68` indexes into the signature type:
`Parameters<typeof hydrateDashboard>[2]`. Adding a parameter before `widgets`
shifts that index and must be updated.

### 3. Regression tests through the real path

New: `app/tests/unit/query-engine/dashboard-role.test.ts` and
`app/tests/unit/security/pii-filter-bypass.test.ts`.
Update: `app/tests/security/pii-filter.test.ts`.

- A viewer loading a dashboard must be blocked from a PII widget; an admin and
  an editor loading the same widget must not be. Drive `hydrateWidgetFromQuery`
  (or the route) so the role actually traverses the chain — asserting on
  `assertRolePermissions` directly is exactly the gap that let this ship.
- The four snake_case cases and the commented wildcard from task 1.
- The 12 existing assertions in `pii-filter.test.ts` must still pass unchanged.
  If any needs editing rather than still passing, that is a signal the new
  pattern is too aggressive — report it instead of loosening the test.

No existing test imports `hydrateWidgetFromQuery`, `hydrateDashboard`,
`resolveConnector` or `executeWithTimeout`, so signature changes break nothing.
The coupling is on `validateQuery` and `assertRolePermissions`, exercised
positionally across 5 files.

## Error-handling requirement

`nlqa/ask/route.ts:199-206` wraps only its own `validateQuery` call in a
try/catch that returns 422. Once the role is passed, `executeWithTimeout` at
`:219` will also throw `ValidationError` for the same query, from a different
catch. A viewer hitting a PII column must get a coherent status, not a 500.
Verify the surrounding error handling and report what it does.

## Out of scope

- HIGH-2 / HIGH-3: `validateQuery` returns `void` and mutates its argument, so
  the auto-injected `LIMIT` is discarded by four callers. Separate feature.
- The `setRole` duck-typing in `resolve.ts:55-59` is dead: `Connector`
  (`connectors/types.ts:63-68`) does not declare it and none of the 9
  implementations define it. Left alone — it is unreachable either way, and
  propagating `role` does not change that.
- The `validateQuery` calls in `lib/alerts/evaluator.ts:70`,
  `api/alert-rules/[id]/route.ts:40`, `api/dashboards/[id]/alerts/route.ts:63`
  and inside 6 connectors pass 2 args. Not touched: `execute.ts` validates before
  invoking a connector, so the role-aware check runs first and the un-typed
  second pass cannot unblock anything.
- The uncommitted design-token work in the working tree stays untouched. Never
  `git add -A`.

## Commits

| Task | Commit | Status |
|---|---|---|
| 1 | — | pending |
| 2 | — | pending |
| 3 | — | pending |
| 4 | — | pending |
