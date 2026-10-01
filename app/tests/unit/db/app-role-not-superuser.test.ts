import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * HIGH-5 — the app must not connect as a superuser.
 *
 * Verified empirically on 2026-09-30 against a live database: the role the app
 * connects as had `rolsuper = t` and `rolbypassrls = t`, and a query scoped to
 * one org returned another org's rows. RLS was not filtering anything.
 *
 * The trap this test exists to catch: the integration suite already creates
 * its `dashbi` role as NOSUPERUSER NOBYPASSRLS on purpose, so every RLS test
 * passes. Those tests prove RLS works. They say nothing about which role the
 * deployed app uses, which is the only part that was wrong.
 *
 * So this asserts the deployed wiring, not the database behavior.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');

/**
 * Two compose files are tracked, and both wire the app to the bootstrap
 * superuser. `docker-compose.yml` at the root is the maintained one (hardened
 * 2026-09-14); `app/docker-compose.yml` is a stale copy from the initial
 * commit that nobody has touched since. Both are asserted here, because a fix
 * applied to only one of them leaves the vulnerability sitting in the tree
 * waiting for someone to run the wrong file.
 */
const COMPOSE_FILES = ['docker-compose.yml', 'app/docker-compose.yml'] as const;

const initScript = readFileSync(
  resolve(REPO_ROOT, 'scripts/postgres/init-roles.sh'),
  'utf8',
);

/** The `DATABASE_URL=...` lines the app and pdf-worker services get. */
function appDatabaseUrls(compose: string): string[] {
  return compose
    .split('\n')
    .filter(
      (line) =>
        /^\s*-\s*DATABASE_URL=/.test(line) || /^\s+DATABASE_URL:\s/.test(line),
    )
    .map((line) => line.trim());
}

describe.each(COMPOSE_FILES)('HIGH-5 — %s', (file) => {
  const compose = readFileSync(resolve(REPO_ROOT, file), 'utf8');

  it('has an app DATABASE_URL to assert against (guards a silently empty parse)', () => {
    expect(appDatabaseUrls(compose).length).toBeGreaterThan(0);
  });

  it('never builds the app DATABASE_URL from POSTGRES_USER', () => {
    // POSTGRES_USER is what the postgres image creates as a superuser. Using it
    // for the app is exactly the bug: that role bypasses RLS no matter what the
    // policies say, and PostgreSQL 15+ refuses to let anyone demote it.
    for (const line of appDatabaseUrls(compose)) {
      expect(line, `app DATABASE_URL still uses the bootstrap superuser: ${line}`).not.toContain(
        '${POSTGRES_USER',
      );
      expect(line, `app DATABASE_URL still uses the bootstrap superuser: ${line}`).not.toContain(
        '${POSTGRES_USER:',
      );
    }
  });

  it('builds the app DATABASE_URL from a dedicated app role', () => {
    for (const line of appDatabaseUrls(compose)) {
      expect(line).toContain('${POSTGRES_APP_USER');
      expect(line).toContain('${POSTGRES_APP_PASSWORD');
    }
  });

  it('exposes a separate owner URL for migrations', () => {
    // Migrations need to own the tables so the app role can be granted DML on
    // them. RLS filters rows; GRANT decides whether you may touch the table at
    // all, and a non-owner needs the grant.
    expect(compose).toContain('DATABASE_MIGRATION_URL');
  });
});

describe('HIGH-5 — the init script creates the roles', () => {
  it('creates the app role as NOSUPERUSER NOBYPASSRLS', () => {
    // The role name and password are psql variables, not literals — a literal
    // role name next to a literal password is how the shipped script ended up
    // with a working credential in the repo.
    expect(initScript).toMatch(
      /CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_password'/,
    );
  });

  it('keeps CREATE ROLE out of dollar-quoted blocks', () => {
    // psql does not interpolate :'var' inside $$ … $$ — the server eats the
    // colon and the whole init script dies with `syntax error at or near ":"`,
    // which the image reports as a successful boot with roles missing.
    const code = initScript
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(code, 'executable SQL must not use dollar quoting').not.toContain('$$');
    expect(code).toMatch(/CREATE ROLE :"app_user"/);
  });

  it('passes the password as a psql variable instead of inlining it', () => {
    // The shipped script had `PASSWORD 'dashbi_readonly_password'` inline,
    // which put a working credential in the repo for every deployment to
    // inherit. -v app_password=... keeps the secret in the environment.
    expect(initScript).not.toMatch(/PASSWORD\s+'/);
    expect(initScript).toMatch(/-v\s+app_password=/);
  });

  it('grants the app role DML but not ownership', () => {
    expect(initScript).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
    expect(initScript).toMatch(/ALTER DEFAULT PRIVILEGES/);
  });

  it('still creates the read-only role for AI-generated SQL', () => {
    expect(initScript).toContain('dashbi_readonly');
    expect(initScript).toMatch(/GRANT SELECT ON ALL TABLES/);
  });
});
