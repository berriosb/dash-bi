# CI Hygiene & Commit Discipline

> Why this exists: between Jul 28 03:31 UTC and Jul 28 04:09 UTC the repo
> absorbed 7 broken CI commits in a row (`d24cd1e` → `60b970b`) before the
> e2e job was even booting a server. Each commit was a band-aid that fixed
> one symptom of a deeper problem nobody had surfaced yet. This document
> codifies the prevention strategy so the trail stays clean.

---

## The Iron Rule

```
Every PR must verify locally with the SAME gates CI runs
  BEFORE a single commit is written.
```

In `dash-bi` those gates are, in order, from `app/package.json`:

```bash
pnpm typecheck
pnpm lint        # errors gate; 59 baseline warnings tolerated
pnpm test        # vitest unit, 408 tests
pnpm build       # next build --webpack, catches server-only leaks
pnpm test:e2e    # playwright + dev server, 95/96 green
```

If any of these fail locally, the change does not get pushed. **No
exceptions, no "I'll fix it after the merge", no trust in the agent
report.** Run, read the output, decide.

---

## Why Local Verification Was Skipped Before

The 7 broken commits all share one anti-pattern:

> "I changed CI. The new behavior is hard to test locally. I'll push and
> let CI tell me."

That converts the merge gate into a debugging tool, which produces:

1. Red CI runs that pollute the timeline.
2. Whack-a-mole fix chains where every commit fixes one symptom of a
   different bug.
3. Masked regressions: while everyone is debugging the latest red, the
   actual product has silent defects (the e2e tests were masking 5
   separate bugs because every test threw `ERR_CONNECTION_REFUSED`).

The cost is non-linear: a 30-second local re-run would have surfaced each
bug; a CI cycle is 5–25 minutes and burns shared runner budget.

---

## Local ↔ CI Parity Checklist

The CI workflow at `.github/workflows/ci.yml` does five things locally-
reproducible people miss. Each item below is the local equivalent.

| CI step                                 | Local equivalent                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `Setup Node 22` (cache pnpm)            | `node --version` → 22.x                                                        |
| `Install dependencies (dev + prod)`      | `pnpm install`                                                                 |
| `pnpm lint`                             | `pnpm lint` (same flags; CI uses `--max-warnings 100`, not strict)             |
| `pnpm typecheck`                        | `pnpm typecheck`                                                               |
| `pnpm test`                             | `pnpm test`                                                                    |
| `pnpm build`                            | `pnpm build`                                                                   |
| `services: postgres / redis`            | `docker compose up -d` (from `app/docker-compose.yml`) — **required for e2e**  |
| `pnpm db:migrate`                       | `pnpm db:migrate`                                                              |
| `Provision dashbi_readonly role`        | `bash scripts/setup-rls.sh` (or let db:migrate handle via compose)             |
| `pnpm playwright install … chromium firefox webkit` | `pnpm playwright install --with-deps chromium firefox webkit`         |
| `pnpm test:e2e` (with webServer)        | `pnpm test:e2e` (config now starts `pnpm dev` automatically when CI=1)         |

If `docker compose` is unavailable locally, e2e must be trusted only
after observing it pass in CI for the same change. Do not skip e2e in
local verification if it's in the CI gate.

---

## Pre-commit Hook (recommended)

The repo already has `husky` and `lint-staged` configured (see
`app/package.json:42`). What is missing is a hook for the CI-mandatory
gates. Add to the husky `pre-commit`:

```sh
# app/.husky/pre-commit
cd app
pnpm typecheck && pnpm lint && pnpm test --run tests/unit
```

This is fast (≤ 1 min) and catches the most common 80% of breakages —
type errors, lint regressions, and unit-test breakage — without
blocking on the slow e2e suite.

`lint-staged` already handles per-file formatting/eslint, but a
pre-commit gate ensures the **whole repo** builds, not just the files
you touched.

---

## Branch Protection (recommended)

The repo currently has no required-status-check on `main`. Anyone can
push directly. Set on GitHub → Settings → Branches → Branch protection
rules:

- **Require a pull request before merging**: yes
- **Required status checks**:
  - `Lint, typecheck, test, build` (the verify job)
  - `Playwright E2E` (no longer optional — see `e943ca0`)
- **Require linear history**: yes (squash merges)
- **Do not allow force pushes**: yes

This alone converts the problem of "broken commit X" into "PR blocked
on red check" — caught at PR open, never lands.

---

## Red-Build Discipline

When CI is red, follow this loop strictly. Don't push follow-up commits
in the same PR you opened.

### Symptom vs. root cause

| Symptom                                              | Root cause                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ERR_CONNECTION_REFUSED` on every test                | webServer disabled in CI / wrong fixture config                                                                  |
| Protected route returns 200 (no redirect)            | middleware file at wrong path / matcher misconfigured                                                            |
| Public route returns 307 → /login                     | PUBLIC_PATHS list incomplete / `startsWith` with no trailing slash (security bypass; see test in `tests/unit/middleware/public-paths.test.ts`) |
| Tests fail with `Executable doesn't exist`            | playwright install step didn't include the browser (firefox, webkit)                                              |
| Locator resolves to N elements (strict mode error)    | Locator ambiguous — use `.first()`, `getByRole`, or a tighter selector                                           |
| `[data-widget-id]` count = 0 on `/demo/dashboard`    | `'use client'` component ignored the `dashboard.widgets` prop and only read store                                 |
| Server-only import in client bundle (build error)     | pino-pretty / fs / postgres leaked past `'use client'` or `import 'server-only'`                                 |

Always separate "fix the immediate symptom" from "fix the systemic
cause". The chain on 2026-07-28 demonstrates the cost of skipping the
second:

```
d24cd1e  ci: add GitHub Actions workflow
7fc3370  fix(ci): run pnpm/action-setup before actions/setup-node
2ec8cb5  fix(ci): unset NODE_ENV for install, set per-step
e8c5663  fix(ci): loosen lint gate to --max-warnings 100
da87985  fix(ci): quote step name with colon
60b970b  fix(ci): generate placeholder secrets at CI time
f985005  fix(ci): provision dashbi_readonly role
fa3f6bd  ci: make e2e job non-blocking   ← stops trying, masks everything
```

8 commits, 0 fixes to the actual product, plus a `continue-on-error: true`
that hides subsequent failures for weeks. None of the follow-ups would
have been necessary if the first commit had:

1. Run the e2e suite once with the workflow YAML mounted as a local act
   job or by hand-spawning the same `pnpm test:e2e` invocation in CI
   mode.
2. Noted that "webServer: undefined in CI" is a no-op and either
   pointed at a real preview deployment or set up `pnpm dev`.

---

## Refactor to Apply If You Reset CI

If you ever need to rebuild the CI from scratch, do it in **one** commit
after locally verifying every step. The pattern that worked on
2026-07-28 (in six commits, all bundled in a single PR-equivalent push
chain):

1. **Decide where the server lives**: either a real preview deployment
   (Vercel preview, Fly staging, etc.) or CI-spawned via
   `webServer.command`.
2. **Match `playwright.config.ts` projects to the install step** —
   `chromium + firefox + webkit` or restrict the projects block to
   `chromium` if you only install one browser.
3. **Match `playwright.config.ts` webServer to the CI runner** — if the
   workflow has `working-directory: app`, the same command must run
   from the same dir locally.
4. **Lock the middleware PUBLIC_PATHS** with a unit test
   (`tests/unit/middleware/public-paths.test.ts` in this repo).
5. **Gate every protected path** — if the middleware silently ignores
   some routes because the file is at the wrong path, you'll only
   notice when an e2e test asserts a redirect. Add a unit test that
   calls `middleware(req)` for each protected path, asserts redirect
   to `/login?redirect=<path>`.
6. **For each new component**, choose one source of truth for its
   data — store OR prop — and write at least one assertion that
   catches store/prop drift.

---

## TDD Discipline for Bug Fixes

Every bugfix commit in this chain followed the same pattern:

1. **Red**: run the existing e2e suite; confirm it fails on the precise
   assertion that catches the bug. Note the failure message — that's
   the "I watched it fail" evidence for the commit message.
2. **Green**: minimal change to make that assertion pass.
3. **Refactor / add unit test**: a fast, deterministic test that
   exercises the specific invariant (e.g. `tests/unit/middleware/
   public-paths.test.ts`). Without this, the next refactor or
   "small tweak" reintroduces the bug silently.
4. **Verify all gates** (typecheck, lint, test, build, e2e) and only
   then commit.

Skipping step 3 was the difference between "protected routes redirect"
working at any point in 2026-07-28 vs. needing three follow-up commits
to make it work AND locking it.

---

## When the Suite is Inherently Flaky

Sometimes e2e tests have flaky roots (timing, race conditions with the
browser, third-party widgets). The right answer is **not** to remove
`continue-on-error: true` permanently — it's to:

1. Add `test.retry(2)` or `test.setTimeout(60_000)` to the flaky test.
2. Mark it with `test.fixme` and link to a tracking issue.
3. Wrap Playwright auto-waits: prefer `expect(locator).toBeVisible()`
   over `expect(await page.textContent(el)).toBe('...')`.

If the only option is `continue-on-error`, **comment it loudly**:

```yaml
# TEMPORARY: e2e suite flaking on chrome >= 131, follow up in
# https://github.com/berriosb/dash-bi/issues/123. This bypass must
# be removed before the next release tag.
continue-on-error: true
```

The day this comment disappears without a linked issue being closed,
it reopens the door to the 2026-07-28 mistake.

---

## TL;DR

1. **Reproduce locally before pushing** — every gate, every time.
2. **Branch-protect `main`** — required status checks, no direct push.
3. **Write the regression test before the fix** — at minimum a unit
   test for any security boundary; the cost is 30 seconds and the
   benefit is "you can't reintroduce this without breaking CI."
4. **One symptom, one commit, one cause** — if a CI red resolves with a
   different bug appearing, *stop and investigate*, don't keep patching.
5. **Don't hide red with `continue-on-error: true`** — if you must,
   tag it with an issue and a date by which it must come off.
