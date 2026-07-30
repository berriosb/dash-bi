import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '@/db/schema';

const RESET_SQL = `
DROP TABLE IF EXISTS nlqa_messages CASCADE;
DROP TABLE IF EXISTS nlqa_conversations CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS llm_usage CASCADE;
DROP TABLE IF EXISTS public_links CASCADE;
DROP TABLE IF EXISTS dashboard_versions CASCADE;
DROP TABLE IF EXISTS dashboards CASCADE;
DROP TABLE IF EXISTS data_sources CASCADE;
DROP TABLE IF EXISTS org_members CASCADE;
DROP TABLE IF EXISTS verifications CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS orgs CASCADE;
DROP TYPE IF EXISTS connector_type CASCADE;
DROP TYPE IF EXISTS theme CASCADE;
DROP TYPE IF EXISTS plan CASCADE;
DROP TYPE IF EXISTS org_role CASCADE;
DROP TYPE IF EXISTS llm_provider CASCADE;
DROP TYPE IF EXISTS nlqa_role CASCADE;
`;

/**
 * Per-process singleton. Vitest runs test files in workers, so we cache
 * one container per test run to avoid paying the ~5s startup cost for
 * every file. Each test gets its own transaction-clean DB by calling
 * `resetDb()` in `beforeEach`.
 */
let container: StartedPostgreSqlContainer | null = null;
let baseClient: ReturnType<typeof postgres> | null = null;
let baseDb: PostgresJsDatabase<typeof schema> | null = null;

export type TestDb = PostgresJsDatabase<typeof schema>;

async function startContainer(): Promise<StartedPostgreSqlContainer> {
  const c = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('dashbi_test')
    .withUsername('test')
    .withPassword('test')
    .start();
  return c;
}

function appConnectionUri(c: StartedPostgreSqlContainer): string {
  // Connect via the container's bootstrap superuser; the test then issues
  // `SET ROLE dashbi` per-transaction so FORCE RLS applies even when the
  // session owner is a superuser.
  return c.getConnectionUri();
}

function listMigrationFiles(): string[] {
  const dir = join(process.cwd(), 'drizzle/migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function readMigration(name: string): string {
  return readFileSync(join(process.cwd(), 'drizzle/migrations', name), 'utf8');
}

async function applyMigrations(db: TestDb): Promise<void> {
  // Bootstrap the `dashbi_readonly` role that migration 0002 references.
  // The init script in docker-compose handles this in production; tests
  // provision the role inline so the GRANT statements succeed.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashbi_readonly') THEN
        CREATE ROLE dashbi_readonly LOGIN PASSWORD 'dashbi';
      END IF;
    END
    $$;
  `);
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO dashbi_readonly`);
  await db.execute(sql`GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashbi_readonly`);
  await db.execute(
    sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashbi_readonly`,
  );

  // Create a non-superuser that the test runs as to exercise FORCE RLS.
  // The default `test` user created by Testcontainers is a superuser, which
  // bypasses RLS even with FORCE; we want to prove RLS works as expected.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashbi') THEN
        CREATE ROLE dashbi LOGIN PASSWORD 'dashbi' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $$;
  `);
  await db.execute(sql`GRANT CONNECT ON DATABASE dashbi_test TO dashbi`);
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO dashbi`);
  // The migration files create tables; after they run we transfer
  // ownership so `dashbi` is the table owner (subject to FORCE RLS).
  for (const file of listMigrationFiles()) {
    const raw = readMigration(file);
    const statements = raw
      .split(/-->\s*statement-breakpoint/g)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
  }

  // Transfer ownership to `dashbi` so subsequent SET ROLE tests exercise
  // FORCE RLS correctly (table owners are normally exempt, but FORCE
  // makes them subject to policies).
  await db.execute(sql`
    DO $$
    DECLARE
      r record;
    BEGIN
      FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO dashbi', r.tablename);
      END LOOP;
    END
    $$;
  `);
}

export async function getTestDb(): Promise<TestDb> {
  if (!container) {
    container = await startContainer();
    const url = appConnectionUri(container);
    baseClient = postgres(url, { max: 4 });
    baseDb = drizzle(baseClient, { schema });
    await applyMigrations(baseDb);
  }
  return baseDb!;
}

export async function resetDb(): Promise<void> {
  if (!baseDb) await getTestDb();
  await baseDb!.execute(sql.raw(RESET_SQL));
  await applyMigrations(baseDb!);
}

export async function closeTestDb(): Promise<void> {
  if (baseClient) {
    await baseClient.end({ timeout: 5 });
    baseClient = null;
  }
  if (container) {
    await container.stop();
    container = null;
  }
  baseDb = null;
}

export function schemaRef(): typeof schema {
  return schema;
}