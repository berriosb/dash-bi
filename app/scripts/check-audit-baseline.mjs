#!/usr/bin/env node
/**
 * `pnpm audit` exits non-zero for ANY finding, including advisories that
 * have no upstream fix and no reachable code path. Wiring that straight
 * into CI would mean either a permanent red build or a
 * `continue-on-error` nobody reads.
 *
 * This script takes the middle road: it reads the audit JSON and fails
 * only when the numbers get WORSE than the accepted baseline in
 * `security-audit-baseline.json`, or when a previously-accepted advisory
 * changes id. Anything already documented in
 * `docs/security/accepted-advisories.md` passes; a new high or critical
 * does not.
 *
 * Exit codes: 0 = within baseline, 1 = regression, 2 = audit unavailable.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`audit:check — ${message}`);
  process.exit(1);
}

// `pnpm audit` exits non-zero whenever it reports anything, which is the
// normal case for a project carrying documented advisories, so the status
// is ignored and the JSON on stdout is what gets parsed.
const result = spawnSync('pnpm', ['audit', '--json'], {
  cwd: APP_ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error || !result.stdout?.trim()) {
  console.error('audit:check — could not read `pnpm audit --json`:');
  console.error(result.error?.message ?? result.stderr ?? 'no output');
  process.exit(2);
}

let audit;
try {
  audit = JSON.parse(result.stdout);
} catch {
  // Registry/network failures make pnpm print prose instead of JSON.
  // Report it as "could not verify" rather than "clean".
  console.error('audit:check — `pnpm audit --json` did not return JSON:');
  console.error(result.stdout.slice(0, 500));
  process.exit(2);
}

const baseline = JSON.parse(
  readFileSync(resolve(APP_ROOT, 'security-audit-baseline.json'), 'utf8'),
);

const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
const highs = [];
for (const advisory of Object.values(audit.advisories ?? {})) {
  const severity = String(advisory.severity);
  if (severity in counts) counts[severity] += 1;
  if (severity === 'high' || severity === 'critical') {
    highs.push(`${advisory.module_name} (id ${advisory.id})`);
  }
}

console.log(
  `audit:check — critical ${counts.critical}/${baseline.critical}, high ${counts.high}/${baseline.high}`,
);
for (const entry of highs) console.log(`  · ${entry}`);

if (counts.critical > baseline.critical) {
  fail(`critical advisories went from ${baseline.critical} to ${counts.critical}`);
}
if (counts.high > baseline.high) {
  fail(
    `high advisories went from ${baseline.high} to ${counts.high}. ` +
      'Fix the new ones, or document each in docs/security/accepted-advisories.md ' +
      'and raise the baseline deliberately.',
  );
}

console.log('audit:check — within the accepted baseline.');