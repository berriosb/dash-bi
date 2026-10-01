import { sql } from 'drizzle-orm';
import { type Tx } from '@/db/client';
import type { InferredColumn, InferredType } from './infer-types';
import { normalizeHeader } from './normalize';
import { parseBareIdent, parseQualifiedIdent, quoteIdent, type QualifiedIdent } from './sql-ident';

const POSTGRES_TYPE_MAP: Record<InferredType, string> = {
  number: 'BIGINT',
  string: 'TEXT',
  date: 'DATE',
  boolean: 'BOOLEAN',
  json: 'JSONB',
};

export function buildCreateTableSQL(
  targetTable: string,
  columns: InferredColumn[],
): string {
  // Validation happens in `parseQualifiedIdent`: `targetTable` is
  // `schema.table`, and anything that is not a bare lowercase identifier is
  // rejected before it can reach the SQL parser.
  const { sql: tableRef } = parseQualifiedIdent(targetTable);

  const columnDefs = columns
    .map((c) => {
      const colIdent = quoteIdent(normalizeHeader(c.name));
      const pgType = POSTGRES_TYPE_MAP[c.type];
      const nullable = c.nullable ? '' : ' NOT NULL';
      return `${colIdent} ${pgType}${nullable}`;
    })
    .join(', ');

  return `CREATE TABLE IF NOT EXISTS ${tableRef} (
  ${quoteIdent('_row_id')} BIGSERIAL PRIMARY KEY,
  ${quoteIdent('org_id')} UUID NOT NULL,
  ${columnDefs}
)`;
}

export function buildRLSPoliciesSQL(targetTable: string): {
  enable: string;
  policy: string;
} {
  const { table, sql: tableRef } = parseQualifiedIdent(targetTable);
  const policyName = quoteIdent(`org_isolation_${table}`);
  return {
    enable: `ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY`,
    policy: `DROP POLICY IF EXISTS ${policyName} ON ${tableRef};
CREATE POLICY ${policyName} ON ${tableRef}
  USING (org_id = app_current_org_id())`,
  };
}

export function buildIndexSQL(
  targetTable: string,
  columns: InferredColumn[],
): string[] {
  let parsed: QualifiedIdent;
  try {
    parsed = parseQualifiedIdent(targetTable);
  } catch {
    // Indexes are an optimization, not a correctness requirement: a table we
    // cannot name safely simply goes unindexed. The CREATE TABLE in the same
    // commit already threw, so this only matters for direct callers.
    return [];
  }
  return columns
    .filter((c) => c.type === 'date' || c.type === 'string')
    .slice(0, 5)
    .map((c) => {
      const colIdent = quoteIdent(normalizeHeader(c.name));
      const idxName = quoteIdent(`${parsed.table}_${normalizeHeader(c.name)}_idx`);
      return `CREATE INDEX IF NOT EXISTS ${idxName} ON ${parsed.sql}(${colIdent})`;
    });
}

export function buildCreateSchemaSQL(schema: string): string {
  return `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(parseBareIdent(schema, 'schema'))}`;
}

export function buildDropTableSQL(targetTable: string): string {
  const { sql: tableRef } = parseQualifiedIdent(targetTable);
  return `DROP TABLE IF EXISTS ${tableRef} CASCADE`;
}

function coerceForPg(value: unknown, type: InferredType): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (s === 'true' || s === 'yes') return true;
        if (s === 'false' || s === 'no') return false;
      }
      return null;
    }
    case 'date': {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime())
          ? null
          : value.toISOString().slice(0, 10);
      }
      if (typeof value === 'string') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      }
      return null;
    }
    case 'json':
      try {
        return JSON.stringify(value);
      } catch {
        return null;
      }
    case 'string':
    default:
      return value;
  }
}

function escapePgLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Materialize the parsed rows into the target table. We rely on the
 * caller to be inside a `withOrgContext` transaction so RLS lets the
 * INSERT through.
 *
 * The Sprint 1.5 MVP embeds values directly into the SQL (after
 * coercion) because better-auth's `tx.execute` doesn't expose a
 * positional param API for `sql.raw` cleanly. Values are pre-coerced
 * and escaped. The *identifier* is a different matter: it is validated
 * and quoted by `parseQualifiedIdent`, never interpolated raw.
 *
 * For 1M+ rows we should switch to `COPY FROM STDIN` via the
 * postgres-js driver's unsafe streaming API. Tracked as Fase 2.
 */
export async function loadRows(
  tx: Tx,
  targetTable: string,
  orgId: string,
  columns: InferredColumn[],
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  if (rows.length === 0) return 0;
  // Validate BEFORE building any statement, so a hostile target table throws
  // without a single `tx.execute` having been issued.
  const { sql: tableRef } = parseQualifiedIdent(targetTable);
  const columnList = ['org_id', ...columns.map((c) => quoteIdent(normalizeHeader(c.name)))].join(', ');

  // Batches of 500 to keep the prepared statement size manageable.
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const valuesSql = batch
      .map((row) => {
        const cells = [
          escapePgLiteral(orgId),
          ...columns.map((col) =>
            escapePgLiteral(coerceForPg(row[normalizeHeader(col.name)], col.type)),
          ),
        ];
        return `(${cells.join(', ')})`;
      })
      .join(', ');

    await tx.execute(
      sql.raw(`INSERT INTO ${tableRef} (${columnList}) VALUES ${valuesSql}`),
    );
    inserted += batch.length;
  }
  return inserted;
}