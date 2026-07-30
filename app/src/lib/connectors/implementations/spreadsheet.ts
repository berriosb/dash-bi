import { sql, eq } from 'drizzle-orm';
import { db, withOrgContext, type Tx } from '@/db/client';
import { uploadedFiles } from '@/db/schema';
import { validateQuery } from '@/lib/security/validate-query';
import type {
  Connector,
  ConnectorConfig,
  ConnectorSchema,
  Query,
  QueryResult,
} from '../types';
import { validatePostgresHost } from '@/lib/security/validate-connection';

export type SpreadsheetConfig = {
  /** id of the row in `uploaded_files` that holds the target table. */
  fileId: string;
};

/**
 * The SpreadsheetConnector executes SQL against a Postgres table that
 * was created from an uploaded CSV/Excel file (see specs/csv-excel-connector.md
 * and `lib/connectors/parsers/load.ts`). The schema, target table, and
 * credentials all live in the `uploaded_files` row, which is fetched
 * via `withOrgContext` so RLS keeps it tenant-scoped.
 *
 * Query protocol:
 *   1. Caller invokes `executeQuery({ kind: 'spreadsheet', fileId, sql })`.
 *   2. We resolve the file row by id (RLS ensures org match).
 *   3. We re-validate the SQL through the postgres connector's
 *      `validateQuery` so SELECT-only / role-based-PII / LIMIT
 *      injection rules apply.
 *   4. We run the SQL inside `withOrgContext` so the per-file
 *      RLS policy accepts the SELECT.
 */
export class SpreadsheetConnector implements Connector {
  type = 'spreadsheet' as const;
  private config: SpreadsheetConfig;

  constructor(connectorConfig: ConnectorConfig) {
    // The dataSources row that points at an uploaded_files row carries
    // the fileId in the encrypted config blob. We don't strictly need
    // to decrypt here because we can also pass fileId via the data
    // source row, but we keep the structure for future config growth.
    this.config = { fileId: '' };
    try {
      const decoded = JSON.parse(
        Buffer.from(connectorConfig.configEncrypted, 'base64').toString('utf8'),
      ) as Partial<SpreadsheetConfig>;
      if (decoded.fileId) this.config.fileId = decoded.fileId;
    } catch {
      // Decryption failure is non-fatal; the query handler will
      // require a fileId in the query itself.
    }
  }

  /**
   * Resolve the metadata for the file backing this connector. Called
   * inside `withOrgContext` so RLS lets us read the row.
   */
  private async resolveFile(tx: Tx, fileId: string) {
    const rows = await tx
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.id, fileId))
      .limit(1);
    return rows[0] ?? null;
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    // No live connection to test (we query Postgres for every
    // request). The "connection" is really "file is queryable".
    const start = Date.now();
    try {
      if (!this.config.fileId) {
        return { ok: false, latencyMs: 0, error: 'Missing fileId in config' };
      }
      const file = await withOrgContext('', null, async (tx) =>
        this.resolveFile(tx, this.config.fileId),
      );
      if (!file) {
        return { ok: false, latencyMs: Date.now() - start, error: 'File not found' };
      }
      // Smoke-test: SELECT 1 FROM <targetTable> LIMIT 1
      await db.execute(sql.raw(`SELECT 1 FROM ${file.targetTable} LIMIT 1`));
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, error: message };
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    if (!this.config.fileId) {
      return { tables: [] };
    }
    const file = await withOrgContext('', null, async (tx) =>
      this.resolveFile(tx, this.config.fileId),
    );
    if (!file) return { tables: [] };
    return {
      tables: [
        {
          // Strip the schema prefix so the AI prompt sees just the
          // table name (the schema is internal to our RLS).
          name: file.targetTable.split('.').pop() ?? file.targetTable,
          columns: file.columns.map((c) => ({
            name: c.name,
            type: mapTypeToConnector(c.type),
            nullable: c.nullable,
          })),
        },
      ],
    };
  }

  async executeQuery<T = Record<string, unknown>>(
    query: Query,
  ): Promise<QueryResult<T>> {
    if (query.kind !== 'spreadsheet') {
      throw new Error('Spreadsheet connector only supports spreadsheet queries');
    }
    const fileId = query.fileId;
    if (!fileId) {
      throw new Error('spreadsheet query requires fileId');
    }
    // Resolve the file (RLS-scoped). We pass orgId="" because the
    // lookup is by primary key; RLS uses the session's GUCs.
    const file = await withOrgContext('', null, async (tx) =>
      this.resolveFile(tx, fileId),
    );
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    // Validate the SQL through the same pipeline as the postgres
    // connector. We treat the file's table as a SQL-injectable
    // surface (the AI generates the query text) so we re-use the
    // existing SELECT-only + LIMIT + role-based-PII rules.
    validateQuery(
      { kind: 'sql', sql: query.sql, params: query.params ?? [] },
      'postgres',
    );

    const start = Date.now();
    // Run inside withOrgContext so the file's RLS policy accepts
    // the SELECT. The `org_id` column is filtered by app_current_org_id().
    const result = await withOrgContext(file.orgId, null, async (tx) => {
      const res = await tx.execute(sql.raw(query.sql));
      const rows = (res as unknown as { rows: unknown[] }).rows ?? [];
      return rows as T[];
    });
    return {
      rows: result as T[],
      rowCount: result.length,
      executionTimeMs: Date.now() - start,
      truncated: result.length >= 10000,
    };
  }
}

function mapTypeToConnector(t: 'number' | 'string' | 'date' | 'boolean' | 'json'): string {
  switch (t) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'json';
    case 'string':
    default:
      return 'string';
  }
}

/**
 * Quick re-export so the `validatePostgresHost` reuses the same
 * SSRF blocklist we use for postgres data sources. (Intentionally
 * re-exported to keep imports tidy; the connector itself doesn't
 * open network sockets, but if a future change introduces
 * spreadsheet-as-a-service it can lean on this.)
 */
export { validatePostgresHost };