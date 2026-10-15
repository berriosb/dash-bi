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

## braces 3.0.3 — 1 advisory (1240992)

- **Path**: `@sentry/nextjs > @sentry/webpack-plugin > @sentry/bundler-plugin-core > unplugin > chokidar > braces`
- **Advisory**: stack exhaustion through deeply nested brace expansion.
- **Patched versions**: none (reported as `<0.0.0`).
- **Why unreachable at runtime**: `chokidar`/`braces` is reached through
  the Sentry webpack plugin's file watcher, which globs paths from our own
  source tree during `next build`. The glob patterns come from the repo,
  not from a request. Nothing in a running container executes it.
- **Residual risk**: a deeply nested glob committed to the repo could stall
  a build. Not attacker-reachable.
- **Retires when**: `braces` or `chokidar` publishes a fix, or Sentry's
  webpack plugin stops pulling `chokidar` 3.
- **Recheck**: 2026-12-14.

---

## Fixed during the hardening pass (kept for the record)

| Advisory | Package | Fix |
| --- | --- | --- |
| 3 critical (`tinypool` ×2, `shell-quote`) | dev/test transitives | `pnpm.overrides` to patched majors |
| GHSA-cjq9-62q9-8jv4 | `next` 16.3.7 SSRF in image optimization | bumped to `next@16.3.8` |
| GHSA-wq5f-xc86-pv6w | `sharp` librsvg | `pnpm.overrides.sharp: ^0.35.5` |
| GHSA-68fv-2mgg-jv7q | `source-map-js` DoS | `pnpm.overrides.source-map-js: ^1.2.2` |
| GHSA-vfj7-8cjw-p6xm | `undici` DoS | `pnpm.overrides.undici: ^6.28.1` |
| GHSA (vite `server.fs.deny` bypass) | `vite` 5.4.21 | vitest 3 → 4 with `vite@^6.4.4` |

Result: **53 findings → 21** (3 critical → 0, 16 high → 3).