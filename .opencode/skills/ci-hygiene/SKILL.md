---
name: ci-hygiene
description: Use before pushing to a remote branch, before claiming a CI configuration is fixed, after CI turns red, or when reviewing any commit chain that masks a real product bug behind CI plumbing. Covers pre-push local verification, symptom→root-cause decision trees for e2e/Playwright/Next.js/middleware failures, the rule against `continue-on-error: true` as a permanent fix, and TDD discipline for bugfix commits. Triggers on phrases like "CI red", "e2e failing", "playwright config", "middleware", "broken commit chain", "commit history sucio", "antes de pushear", "fallo el último despliegue", "no quiero ensuciar el repo", or any time the user is touching `.github/workflows/`, `playwright.config.ts`, `middleware.ts`, or the e2e suite. Not a substitute for `verification-before-completion` (which covers "claim done"); this skill covers the *CI shape* and *commit discipline* below it.
user-invocable: true
argument-hint: "[ci-red | pre-push | commit-chain | skip-policy] [run-id|commit-sha]"
version: 1.0.0
allowed-tools:
  - Bash(gh *)
  - Bash(pnpm *)
  - Bash(git *)
license: AGPL-3.0
---

This skill codifies dash-bi's CI discipline. It exists because on
2026-07-28 the repo absorbed 7 broken CI commits in a row before the
e2e suite booted a server, hiding 5 separate product bugs behind
`continue-on-error: true`. The long-form reference is
`docs/ci-hygiene.md`; this skill is the procedural entry point.

## Iron rule

**Every push to `main` must have run the same gates the CI runs, on
the same code, before the commit is written.** No exceptions, no
"trust the agent report", no "I'll fix it after merge".

```bash
cd app
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

For e2e — which the chain on 2026-07-28 skipped — the local
equivalent today is:

```bash
docker compose up -d                 # postgres + redis
pnpm db:migrate
pnpm playwright install --with-deps chromium firefox webkit
CI=1 pnpm test:e2e
```

If `docker compose` is unavailable locally, you may defer e2e to CI,
but only **once, for one push** — and you must read the resulting CI
log before declaring done. See `references/local-ci-parity.md` for
the full mapping table.

## Symptom → root cause (dash-bi specific)

When CI is red with one of these signatures, the listed cause is the
most likely. Verify before fixing: download the job log with `gh run
view <run-id> --job <job-id> --log`, then check the file/line noted.

| Symptom (CI log signature)                                                  | Most likely cause                                                            | Where to look                                         |
|-----------------------------------------------------------------------------|------------------------------------------------------------------------------|-------------------------------------------------------|
| All e2e tests fail with `ERR_CONNECTION_REFUSED` on `http://localhost:3000/` | `webServer: undefined` in `app/playwright.config.ts` for `CI` branch         | `app/playwright.config.ts:33-40`                      |
| One specific browser project fails: `browserType.launch: Executable doesn't exist` | CI installed only chromium but config has 3 projects (chromium/firefox/mobile-safari) | `.github/workflows/ci.yml:195` `playwright install`    |
| Protected route returns HTTP 200 in dev (no redirect)                       | Middleware file at wrong location — Next 16 ignores `app/middleware.ts` because the App Router is at `app/src/app/` | Move to `app/src/middleware.ts`                       |
| Public route `/` or `/demo/...` returns 307 → `/login`                       | Missing entry in `PUBLIC_PATHS`                                              | `app/src/middleware.ts:3-15`                          |
| `pathname.startsWith('/login')` matches `/loginv2` (security bypass)         | `PUBLIC_PATHS` entry has no trailing slash and no exact-match check          | `app/src/middleware.ts:29-31` (security-critical)     |
| Tests assert `[data-dashboard-ready="true"]` doesn't exist                   | `'use client'` component (e.g. `DashboardGrid`) reads widgets from Zustand and ignores the prop, never seeded for read-only pages | `app/src/components/dashboard/DashboardGrid.tsx:36`   |
| `strict mode violation: getByText resolved to N elements`                    | Regex locator matches multiple widgets; needs `.first()` or `getByRole`     | `app/tests/e2e/*.spec.ts`                             |
| E2E blocked with `localhost:6379 ECONNREFUSED`                              | `docker compose` services not running locally, OR workflow missing `services:` block | `.github/workflows/ci.yml` services block             |
| Build fails: `Module not found 'pino-pretty'` from a client component         | Server-only import leaked into client bundle. Server-only modules must be referenced via `import 'server-only'` or placed under a `'use server'` boundary | `pnpm build` output                                         |

## Bugfix commit discipline (TDD)

When fixing any CI / e2e / middleware / build issue, the commit chain
that already worked in this repo was **per bug**:

1. **Red**: confirm the existing e2e suite fails on the precise
   assertion. Note the exact error message — that's the "I watched it
   fail" evidence for the commit body.
2. **Green**: minimal change to make that assertion pass. One
   symptom, one root cause.
3. **Lock the invariant**: add a fast unit test (`pnpm vitest`) that
   exercises the specific boundary. Without this, the next refactor
   silently reintroduces the bug.
4. **Verify all gates**: typecheck, lint, test, build, e2e.
5. **Commit**. Push only after step 4 output is in front of you.

Skipping step 3 was the difference between "protected routes
redirect" being observable on day 1 vs. needing 3 follow-up commits
to fix it AND lock it.

## Red-build discipline

When CI is red, do not stack fix-on-top-of-fix in the same PR. If the
second fix surfaces a *different* bug, **stop and revert to a clean
state** before continuing. The 2026-07-28 chain is the textbook
example of why:

```
d24cd1e  ci: add workflow                  ← should have been tested locally
7fc3370  fix: action order                 ← symptom
2ec8cb5  fix: NODE_ENV unset               ← symptom
e8c5663  fix: lint --max-warnings 100      ← loosens the gate
da87985  fix: YAML colon                   ← symptom
60b970b  fix: secrets at runtime           ← symptom
f985005  fix: provision role               ← symptom
fa3f6bd  e2e non-blocking                  ← stops trying, masks everything
```

8 commits, 0 product fixes, plus a `continue-on-error: true` that hid
every subsequent regression. Each follow-up only addressed the test
broken by the *previous* fix; none addressed the underlying
"webServer is off in CI" because nobody ran the suite locally.

## `continue-on-error: true` policy

CI YAML `continue-on-error: true` is acceptable as a **temporary**
bypass under three conditions, all of which must hold:

1. **An open tracking issue** is linked from an inline YAML comment.
2. **A removal date** is documented in the same comment.
3. **The bypass is loud**: a comment above the line explains what
   real failure it tolerates, not what product bug it hides.

Removing the bypass is a follow-up PR of its own. The day this
comment disappears without a closed linked issue, **re-introduce it
or surface the regression** — never silently land around it.

The bypass in `.github/workflows/ci.yml` on `e2e: continue-on-error`
was removed in commit `e943ca0` after the suite hit 95/96.

## Local ↔ CI parity (quick reference)

For each CI step, here's the local reproducer. Full table in
`docs/ci-hygiene.md`.

| CI step                                                | Local run                                                |
|--------------------------------------------------------|----------------------------------------------------------|
| `actions/setup-node@v4` (Node 22)                      | `nvm use 22` or `.nvmrc`                                 |
| `pnpm install --frozen-lockfile`                       | `pnpm install --frozen-lockfile`                         |
| `pnpm lint` (CI: `--max-warnings 100`)                 | `pnpm lint` (warning baseline is 59, gate allows 100)    |
| `pnpm typecheck`                                       | `pnpm typecheck`                                         |
| `pnpm test`                                            | `pnpm test`                                              |
| `pnpm build`                                           | `pnpm build`                                             |
| `services: postgres:16 / redis:7`                      | `docker compose up -d postgres redis`                    |
| `pnpm db:migrate`                                      | `pnpm db:migrate`                                        |
| `pnpm playwright install --with-deps chromium firefox webkit` | identical                                              |
| `pnpm test:e2e` (with webServer from config)           | `pnpm test:e2e` (Playwright spawns `pnpm dev` when `CI=1`) |

## When the user asks "is it done?" after CI changes

Before answering:

1. Did you read the actual `gh run view <id>` log output for the
   failing job? If not, ask for it and parse it. Never infer from the
   green/red status alone — `continue-on-error: true` makes the run
   green while a job is red.
2. Does the local reproducer (table above) pass when you run it
   yourself? Not "the agent said it does".
3. Is the regression covered by a unit test or e2e assertion? If not,
   the next refactor reintroduces the bug.
4. Only answer YES with the evidence in this message.

## References

- `docs/ci-hygiene.md` — long-form reference, includes the full CI
  step-by-step reproduction script and the policy rationale.
- `app/tests/unit/middleware/public-paths.test.ts` — example
  invariant-locking test (22 cases, security boundary).
- `.github/workflows/ci.yml` — the live workflow; line numbers in the
  symptom table above reference this file.
- Skill `verification-before-completion` — use **together** with
  this skill: this one guards the CI shape, that one guards the
  evidence-before-claim gate.
