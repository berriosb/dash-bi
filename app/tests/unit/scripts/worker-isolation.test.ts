import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The PDF renderer opens Chrome over tenant-controlled content. The
 * container that runs it must not hold the credentials of the rest of the
 * system: the DB owner, the read-only role, the master key that decrypts
 * every BYOK.
 *
 * These are compose invariants, asserted on the files themselves so a
 * future edit that puts the credentials back fails here.
 */

// tests/unit/scripts/*.test.ts → app/tests/unit/scripts → app → <repo>
const REPO_ROOT = resolve(__dirname, '../../../..');
const ROOT_COMPOSE = resolve(REPO_ROOT, 'docker-compose.yml');
const DEV_COMPOSE = resolve(REPO_ROOT, 'app/docker-compose.yml');

/** The block of a compose service, by its top-level indentation. */
function serviceBlock(source: string, service: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`  ${service}:`));
  if (start === -1) throw new Error(`service '${service}' not found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line));
  const block = lines.slice(start, end === -1 ? undefined : start + 1 + end).join('\n');
  // Comments explain what a service must NOT carry; only the declarations
  // count.
  return block
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

const CREDENTIALS = [
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'DATABASE_READONLY_URL',
  'LLM_KEY_ENCRYPTION_KEY',
  'RESEND_API_KEY',
];

describe.each([
  ['root compose (production)', ROOT_COMPOSE],
  ['dev compose', DEV_COMPOSE],
])('worker isolation — %s', (_label, composePath) => {
  let source: string;

  beforeAll(() => {
    if (!existsSync(composePath)) {
      throw new Error(`Missing compose file: ${composePath}`);
    }
    source = readFileSync(composePath, 'utf8');
  });

  it('the pdf renderer service has no database or key credentials', () => {
    const block = serviceBlock(source, 'pdf-worker');
    for (const credential of CREDENTIALS) {
      expect(block, `pdf-worker must not declare ${credential}`).not.toContain(credential);
    }
  });

  it('the pdf renderer service is pinned to the pdf role', () => {
    const block = serviceBlock(source, 'pdf-worker');
    expect(block).toMatch(/WORKER_ROLE[:=]\s*pdf/);
  });

  it('the jobs worker service is pinned to the jobs role', () => {
    const block = serviceBlock(source, 'jobs-worker');
    expect(block).toMatch(/WORKER_ROLE[:=]\s*jobs/);
  });

  it('the jobs worker service has the database and the master key', () => {
    const block = serviceBlock(source, 'jobs-worker');
    expect(block).toContain('DATABASE_URL');
    expect(block).toContain('DATABASE_READONLY_URL');
    expect(block).toContain('LLM_KEY_ENCRYPTION_KEY');
  });

  it('no worker service carries the owner credential', () => {
    // `DATABASE_MIGRATION_URL` is the OWNER of the tables. It is only
    // needed to run migrations.
    for (const service of ['pdf-worker', 'jobs-worker']) {
      const block = serviceBlock(source, service);
      expect(block, `${service} must not declare DATABASE_MIGRATION_URL`).not.toContain(
        'DATABASE_MIGRATION_URL',
      );
    }
  });
});
