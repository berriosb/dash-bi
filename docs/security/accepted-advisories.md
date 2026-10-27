# Accepted advisories

Advisories that `pnpm audit` reports and that dash-bi does **not** fix,
because no fix exists or because the vulnerable code is unreachable in a
deployed dash-bi. Every entry needs a reason, a recheck date, and a
condition that retires it.

The gate is `pnpm audit:check` (script: `app/scripts/check-audit-baseline.mjs`,
baseline: `app/security-audit-baseline.json`). It fails when the count of
`high` or `critical` advisories rises above the baseline, so this file
cannot rot into a blanket waiver — a new high has to be justified here or
fixed.

**The gate runs in CI.** The job lives in the repository-root
`.github/workflows/ci.yml` (job `audit`). It used to live in
`app/.github/workflows/ci.yml`, where GitHub never executed it: Actions only
discovers workflows under the repository root's `.github/workflows/`. The gate
was silently absent for the whole life of that file, and the baseline drifted
from `critical: 0, high: 3` to a tree that actually carried 3 critical and 7
high advisories.

`pnpm audit --audit-level=high` is kept as a human-facing command. It
still exits non-zero, by design: these advisories are real, they just are
not reachable.

---

## extract-zip 2.0.1 — 2 advisories (1139346, 1193685)

- **Path**: `puppeteer > @puppeteer/browsers > extract-zip`
- **Advisories**: unvalidated symlink path traversal; arbitrary file write
  through symlink archive entries.
- **Patched versions**: none. The npm advisory reports `<0.0.0`, i.e. there
  is no fixed release to move to. Overriding the version cannot fix it.
- **Why unreachable at runtime**: `extract-zip` is invoked by
  `@puppeteer/browsers` while Puppeteer *downloads and unpacks* Chrome into
  the image. It runs during `docker build`, against an archive fetched from
  Google's storage over TLS, and never in the app or worker container. A
  `dashbi/app` runtime container does not contain the download step and
  does not execute `extract-zip`.
- **Residual risk**: a compromised Chrome archive at build time could write
  outside the cache directory. That is a build-supply-chain risk, covered
  by image provenance, not by an application boundary.
- **Retires when**: `@puppeteer/browsers` ships a version that drops
  `extract-zip` or replaces it with a fixed implementation.
- **Recheck**: 2026-12-14.

## zod 3.25.76 — 1 advisory (1243066)

- **Path**: direct dependency (`zod@^3.24.0`) plus the AI SDK provider chain
  (`ai` / `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google` →
  `@ai-sdk/provider-utils` → `zod@3.25.76`) and `puppeteer > chromium-bidi`.
- **Advisory**: memory exhaustion while validating oversized constrained
  collections.
- **Patched versions**: `>=4.6.6`. The advisory's vulnerable range is
  `<4.6.6`, which covers **every** 3.x release — there is no patched 3.x.
- **Why not fixed**: fixing it means migrating the project to zod 4. The
  application code uses zod 3 APIs directly (`z.object`, `.url()`,
  `.default()`, `.optional()` and the discriminated unions in the route
  schemas), and zod 4 changes error shapes and several method signatures.
  That is a migration with its own regression surface, not a dependency bump,
  and it does not belong in a security patch.
- **Partial mitigation**: `pnpm.overrides["zod@^4.0.0"] = "^4.6.6"` pins the
  only zod 4 branch in the tree — the one under `better-auth` — to a patched
  version. The vulnerable 3.25.76 copy remains for the direct dependency and
  the AI SDK chain.
- **Residual risk**: a request that sends an oversized collection to a route
  whose zod schema declares a bounded array could exhaust memory in the
  validating process. The auth routes are rate limited (30 requests / 60 s
  globally, 3–5 per sensitive action); the AI routes are rate limited per org
  and per IP.
- **Retires when**: the project migrates to zod 4, or zod publishes a
  backported fix for the 3.x line.
- **Recheck**: 2026-12-14.

## happy-dom 20.11.1 — 1 advisory (1243084)

- **Path**: `better-auth > vitest > happy-dom` (the peer-optional DOM
  implementation used by the component tests).
- **Advisory**: incomplete fix for CVE-2026-33943 — unsanitized `img`
  handling.
- **Patched versions**: `>=21.0.4`.
- **Why not fixed**: `happy-dom` is a dev-only dependency that never ships
  in a runtime container; it exists to give Vitest a DOM. The advisory
  concerns markup sanitization inside a simulated browser, so the worst case
  is a test that fails to observe an XSS it should have observed — a gap in
  test signal, not a runtime hole.
- **Why the override did not work**: `pnpm.overrides["vitest>happy-dom"]`
  changes the declared range, but `happy-dom` is an *optional peer
  dependency* of Vitest and the resolution is pinned by the lockfile entry
  rather than by the range, so the override does not move the installed
  version.
- **Residual risk**: test-signal only. No production code path imports
  `happy-dom`.
- **Retires when**: Vitest's optional peer resolves to `>=21.0.4` (Vitest
  5.x), or the project replaces the DOM environment.
- **Recheck**: 2026-12-14.

---

## Fixed during the hardening pass (kept for the record)

| Advisory | Package | Fix |
| --- | --- | --- |
| 3 critical (`tinypool` ×2, `shell-quote`) | dev/test transitives | `pnpm.overrides` to patched majors |
| GHSA-cjq9-62q9-8jv4 | `next` 16.3.7 SSRF in image optimization | bumped to `next@16.3.8` |
| GHSA-wq5f-xc86-pv6w | `sharp` librsvg | `pnpm.overrides.sharp: ^0.35.5` |
| GHSA-68fv-2mgg-jv7q | `source-map-js` DoS | `pnpm.overrides.source-map-js: ^1.2.2` |
| GHSA-vfj7-8cjw-p6xm | `undici` DoS | `pnpm.overrides.undici: ^6.28.1`, later `^6.29.1` |
| GHSA (vite `server.fs.deny` bypass) | `vite` 5.4.21 | vitest 3 → 4 with `vite@^6.4.4` |
| 2 critical | `next` 16.3.8 — unauthenticated RCE in `use cache` and in Image Optimization | bumped to `next@16.4.3` |
| 1 critical | `@sentry/nextjs` 9.47.1 — middleware bypass via the tunnel route (not reachable: the repo uses no tunnel) | bumped to `@sentry/nextjs@9.47.2` |
| GHSA-xjj6-f33q-929c | `undici` DoS via excessive content-encodings | `pnpm.overrides.undici: ^6.29.1` |
| 1 high (`braces`, id 1240992) | `@sentry/nextjs` webpack plugin chain | dropped when `@sentry/nextjs` moved to 9.47.2 |

Result: **36 findings → 27** (3 critical → 0, 7 high → 4).