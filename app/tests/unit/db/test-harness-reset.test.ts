import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import { RESET_SQL } from '../../integration/postgres';

/**
 * The integration harness resets the database by dropping and re-creating
 * every table. A table that is added to the Drizzle schema but forgotten here
 * keeps its rows across a reset while the tables it references are dropped and
 * recreated empty.
 *
 * The symptom is not "the harness is stale". It is a foreign-key violation
 * raised from `applyMigrations()` in whichever test happens to run second:
 *
 *   insert or update on table "scheduled_reports" violates foreign key
 *   constraint "fk_sched_reports_org"
 *   Key (org_id)=(08e63715-...) is not present in table "orgs"
 *
 * which reads like a schema bug and sends you to the wrong file. It cost a red
 * CI run when scheduled_reports was added to the schema, and uploaded_files was
 * quietly missing the whole time.
 *
 * This test needs no database, so it runs in the unit suite on every commit
 * instead of only in CI behind a container.
 */
function schemaTableNames(): string[] {
  // The module namespace also exports pgEnum values, so it is read as
  // `unknown` and filtered at runtime: a type predicate over this union does
  // not narrow it, because the exports are concrete `PgTableWithColumns<…>`
  // instantiations rather than the generic `PgTable` the guard would assert.
  return Object.values(schema as Record<string, unknown>)
    .filter((value) => value instanceof PgTable)
    .map((table) => getTableName(table as PgTable))
    .sort();
}

function droppedTableNames(): Set<string> {
  const names = new Set<string>();
  for (const match of RESET_SQL.matchAll(/DROP TABLE IF EXISTS\s+([a-z0-9_]+)/g)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return names;
}

describe('integration harness — resetDb() covers the schema', () => {
  it('finds tables in the schema (guards against a silently empty list)', () => {
    expect(schemaTableNames().length).toBeGreaterThan(15);
  });

  it('drops every table declared in the Drizzle schema', () => {
    const dropped = droppedTableNames();
    const missing = schemaTableNames().filter((name) => !dropped.has(name));
    expect(
      missing,
      'these tables survive resetDb() with their rows intact, so the next ' +
        'applyMigrations() re-adds foreign keys and fails on the orphans. ' +
        'Add them to RESET_SQL in tests/integration/postgres.ts, children ' +
        'before parents.',
    ).toEqual([]);
  });
});
