import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetDb, closeTestDb, type TestDb } from './postgres';
import { safeTableName } from '@/lib/connectors/parsers/normalize';

/**
 * Migration 0016 — the database is the backstop for the `targetTable`
 * collision.
 *
 * The application no longer produces a colliding name: `safeTableName`
 * derives the suffix from the file id, which is unique by construction. That
 * is the primary fix, and it is unit-tested in
 * `tests/unit/connectors/parsers/safe-table-name-collision.test.ts`.
 *
 * This suite covers the part that is not the app's to get right. The bug was
 * invisible for a concrete reason: the existing index on
 * `(org_id, target_table)` was NOT unique, so the database cheerfully stored
 * two rows pointing at one table. Without a unique index, any future
 * regression in the naming scheme reintroduces silent data corruption, and
 * nothing complains until a user notices their second upload overwrote the
 * first.
 *
 * Requires Docker; skips -- visibly, not as a pass -- without a container
 * runtime, unless RLS_TESTS_REQUIRED=1.
 */
const RUNTIME_UNAVAILABLE = /container runtime|Could not find a working container runtime/i;

const ORG = '11111111-1111-1111-1111-111111111111';
const USER = '33333333-3333-3333-3333-333333333333';
const FILE_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILE_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe('uploaded_files target table is unique per org (migration 0016)', () => {
  let db: TestDb;
  let runtimeAvailable = false;

  beforeAll(async () => {
    try {
      db = await getTestDb();
      runtimeAvailable = true;
    } catch (error) {
      if (RUNTIME_UNAVAILABLE.test(String(error))) {
        if (process.env.RLS_TESTS_REQUIRED === '1') throw error;
        console.warn('[integration] skipped: no container runtime for Postgres');
        return;
      }
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    if (db) await closeTestDb();
  });

  beforeEach(async () => {
    if (db) await resetDb();
  }, 60_000);

  // Vitest only exposes ctx.skip() inside a test body, so availability is
  // checked per test. Without this the assertions return early and vitest
  // reports them PASSED -- a green suite that verified nothing.
  function itWithDb(name: string, fn: () => Promise<void>): void {
    it(name, async (ctx) => {
      if (!runtimeAvailable || !db) {
        ctx.skip();
        return;
      }
      await fn();
    });
  }

  async function seed(): Promise<void> {
    await db.execute(
      sql`INSERT INTO users (id, name, email) VALUES (${USER}, 'u', 'u@x.invalid')`,
    );
    await db.execute(
      sql`INSERT INTO orgs (id, name, slug) VALUES (${ORG}, 'Org', 'org-0016')`,
    );
  }

  async function insertFile(fileId: string, targetTable: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO uploaded_files
        (id, org_id, name, original_filename, format, size_bytes, target_table, row_count, columns, created_by)
      VALUES
        (${fileId}, ${ORG}, 'V', 'Ventas.csv', 'csv', 10, ${targetTable}, 5, '[]'::jsonb, ${USER})
    `);
  }

  itWithDb('creates the unique index', async () => {
    const rows = await db.execute<{ indexdef: string }>(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'uploaded_files' AND indexname = 'uploaded_files_org_target_uniq'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('CREATE UNIQUE INDEX');
  });

  itWithDb('rejects two files pointing at the same table in the same org', async () => {
    await seed();
    const target = safeTableName('Ventas.csv', ORG, FILE_A);
    await insertFile(FILE_A, target);

    // The exact shape the bug took: same org, same normalized filename, so
    // the same target table. Before 0016 the database stored this silently.
    const err = await insertFile(FILE_B, target).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorText(err)).toMatch(/unique constraint/i);
  });

  itWithDb('accepts the two colliding filenames once each gets its own file id', async () => {
    await seed();
    // The application-level fix, exercised end to end: what the upload route
    // now actually stores for "Ventas.csv" and "Ventas.xlsx" in one org.
    await insertFile(FILE_A, safeTableName('Ventas.csv', ORG, FILE_A));
    await insertFile(FILE_B, safeTableName('Ventas.xlsx', ORG, FILE_B));

    const rows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM uploaded_files WHERE org_id = ${ORG}`,
    );
    expect(rows[0]?.n).toBe(2);
  });

  itWithDb('keeps the old non-unique index for the org-scoped read path', async () => {
    // Dropping it would be a silent performance regression on the only
    // access pattern that matters: list a tenant's uploads.
    const rows = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'uploaded_files' AND indexname = 'uploaded_files_target_table_idx'
    `);
    expect(rows).toHaveLength(1);
  });
});

/** Drizzle wraps driver errors; the useful text is in the `cause`. */
function errorText(error: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = error;
  for (let depth = 0; cursor && depth < 10; depth += 1) {
    if (typeof cursor !== 'object') {
      parts.push(String(cursor));
      break;
    }
    const record = cursor as { message?: unknown; cause?: unknown };
    if (typeof record.message === 'string') parts.push(record.message);
    cursor = record.cause;
  }
  return parts.join(' | ');
}
