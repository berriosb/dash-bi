# E2E Tests (Playwright)

End-to-end tests live under `app/tests/e2e/`. They boot the Next.js dev
server via `app/playwright.config.ts` `webServer` and exercise the real
Postgres + Redis + better-auth stack — there are no MSW handlers and no
LLM mocks. Tests that need a fresh user create one via the better-auth
API and mark `email_verified = true` directly in the database (the
`MockEmailProvider` swallows the verification email in dev/CI).

---

## Layout

```
tests/e2e/
├── helpers/                ← shared test utilities
│   ├── auth.ts             ← signUpAndVerify, signInViaUI
│   └── db.ts               ← markEmailVerified (email-verification workaround)
├── pages/                  ← Page Object Model
│   ├── login.page.ts       ← Spanish-locale login form selectors
│   └── onboarding.page.ts  ← 4-step wizard selectors + helpers
├── *.spec.ts               ← the actual test files
└── README.md               ← this file
```

The `helpers/` directory is intentionally separate from the test specs
so Playwright's default `*.spec.ts` matcher doesn't try to run them as
tests.

---

## Local quickstart

```bash
cd app

# 1. Bring up Postgres + Redis (already running in CI; locally these
#    come from docker-compose.yml. If they're not already up:
docker compose up -d postgres redis
#    The first time you run this the compose YAML may also need the
#    POSTGRES_* and BETTER_AUTH_SECRET env vars exported; copy them
#    from .env.example.

# 2. Run migrations
pnpm db:migrate

# 3. Install all three browsers the playwright config references
pnpm playwright install --with-deps chromium firefox webkit

# 4. Run a subset (see below)
```

The `webServer` config in `app/playwright.config.ts` spawns
`pnpm dev` automatically when `CI=1` is set; locally it reuses an
existing dev server if one is already running on port 3000.

---

## Selective runs

| Command                       | Scope                                  | Time (approx) |
| ----------------------------- | -------------------------------------- | ------------- |
| `pnpm test:e2e:smoke`         | `@smoke` tag, chromium only            | ~30s          |
| `pnpm test:e2e:critical`      | `@critical` tag, all 3 projects        | ~3 min        |
| `pnpm test:e2e:flake-check`   | `@critical` × 3 repeats (local flake hunt) | ~10 min  |
| `pnpm test:e2e`               | full suite, all 3 projects             | ~14 min       |
| `pnpm test:e2e:ui`            | full suite, Playwright UI mode         | interactive   |

`@smoke` covers the public surfaces (home, login, signup, demo
dashboard, theme switch, a11y, export dialog) and runs in under 30
seconds. `@critical` covers the security boundaries (protected route
redirects, embed token validation) that must-pass on every PR. The
full suite is what CI runs.

---

## Tag conventions

Apply tags via `test.describe(title, { tag }, fn)` (group level) or
`test(title, { tag }, fn)` (individual test level). Don't tag tests
that are inherently slow (`@slow` is the only exception, for tests
that genuinely need signup + API + UI round-trips).

| Tag          | Use when                                                      |
| ------------ | ------------------------------------------------------------- |
| `@smoke`     | < 30s, no DB, no signup, runs on every PR sanity check        |
| `@critical`  | Security boundary or contract that must always pass           |
| `@slow`      | Login + API + UI round-trip; not part of `@smoke`             |
| (untagged)   | Browser-matrix coverage tests (mobile-safari, responsive, etc) |

If you're not sure which tag fits, leave it untagged. The full
suite still runs it.

---

## Writing a new spec

1. **Put helpers in `helpers/`, locators in `pages/`.** Don't inline
   `page.getByLabel(/.../i)` in a spec if it's used twice.
2. **Use `signUpAndVerify` + `signInViaUI`** for any test that needs a
   logged-in user. Don't roll your own better-auth + DB dance.
3. **Avoid `.fill()` on freshly-hydrated React inputs if WebKit is in
   scope.** Use `pressSequentially({ delay: 10 })` instead. See
   `helpers/auth.ts` for the working pattern.
4. **Tag the test** (`@smoke` / `@critical` / `@slow` / untagged).
5. **Run `pnpm test:e2e:smoke` locally** before pushing. If your test
   needs `@slow` or is browser-specific, run the full suite.

---

## Debugging

```bash
# Interactive UI mode — click through the test as it runs
pnpm test:e2e:ui

# Show last HTML report
pnpm playwright show-report

# Open the trace of the most recent failed test
pnpm playwright show-trace test-results/<name>/trace.zip

# List the failing tests on a specific spec, in headed mode
pnpm playwright test tests/e2e/foo.spec.ts --headed --project=chromium
```

In CI, the `playwright-report` artifact (uploaded by `.github/workflows/ci.yml`)
contains the HTML report + per-test screenshots/traces/videos.
Download it from the run summary page and run `pnpm playwright
show-report` against the extracted directory.

---

## CI

The e2e job is **blocking** (no `continue-on-error`). It depends on
the `verify` job (lint + typecheck + unit + build) passing first.
Postgres and Redis come from `services:` blocks in
`.github/workflows/ci.yml`; the dashbi_readonly role is provisioned
inline; migrations run before the suite; all three browsers are
installed via `pnpm playwright install --with-deps`.

See `docs/ci-hygiene.md` for the iron rule on local verification
before pushing, and the symptom→root-cause table for the most common
e2e failures (webServer off, browser missing, middleware at wrong
path, etc.).
