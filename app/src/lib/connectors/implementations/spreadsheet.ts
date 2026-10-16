import { sql, eq } from 'drizzle-orm';
import { withOrgContext, withOrgContextReadOnly, type Tx } from '@/db/client';
import { uploadedFiles } from '@/db/schema';
import { validateQuery } from '@/lib/security/validate-query';
import { decryptApiKey } from '@/lib/security/encryption';
import { parseQualifiedIdent } from '@/lib/connectors/parsers/sql-ident';
import type { OrgRole } from '@/lib/auth/permissions';
import { throwIfAborted } from '../types';
import type {
  Connector,
  ConnectorConfig,
  ConnectorSchema,
  ExecuteQueryOptions,
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
 *   2. We resolve the file row by id (RLS ensures org match) with the app
 *      role — it owns the tenant metadata.
 *   3. We re-validate the SQL through the postgres connector's
 *      `validateQuery` so SELECT-only / role-based-PII / LIMIT
 *      injection rules apply.
 *   4. We run the SQL as `dashbi_readonly` via `withOrgContextReadOnly`.
 *
 * Step 4 is a security boundary, not a performance choice. The app role has
 * SELECT on every table in `public`, including the global auth tables
 * (`users`, `sessions`, …) that a tenant-scoped RLS policy cannot protect.
 * Running user- and AI-written SQL on that role meant a single crafted
 * query could read another tenant's sessions. The read-only role is
 * NOSUPERUSER NOBYPASSRLS and is revoked from those tables by migration
 * 0017, so an injected query cannot cross the tenant boundary even if
 * `validateQuery` is bypassed.
 */
export class SpreadsheetConnector implements Connector {
  type = 'spreadsheet' as const;
  private config: SpreadsheetConfig;
  private orgId: string;
  private role?: OrgRole;

  constructor(connectorConfig: ConnectorConfig) {
    this.orgId = connectorConfig.orgId;
    this.config = { fileId: '' };
    try {
      const decrypted = decryptApiKey(connectorConfig.configEncrypted);
      const decoded = JSON.parse(decrypted) as Partial<SpreadsheetConfig>;
      if (decoded.fileId) this.config.fileId = decoded.fileId;
    } catch {
      try {
        const decoded = JSON.parse(
          Buffer.from(connectorConfig.configEncrypted, 'base64').toString('utf8'),
        ) as Partial<SpreadsheetConfig>;
        if (decoded.fileId) this.config.fileId = decoded.fileId;
      } catch {
        // Decryption failure is non-fatal if query provides fileId directly.
      }
    }
  }

  setRole(role: OrgRole): void {
    this.role = role;
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
    const start = Date.now();
    try {
      if (!this.config.fileId) {
        return { ok: false, latencyMs: 0, error: 'Missing fileId in config' };
      }
      const file = await withOrgContext(this.orgId, null, async (tx) => {
        const found = await this.resolveFile(tx, this.config.fileId);
        if (!found) return null;
        // The probe is a read of tenant data, so it runs on the read-only
        // role for the same reason executeQuery does.
        const target = parseQualifiedIdent(found.targetTable);
        await withOrgContextReadOnly(this.orgId, null, async (roTx) => {
          await roTx.execute(sql.raw(`SELECT 1 FROM ${target.sql} LIMIT 1`));
        });
        return found;
      });
      if (!file) {
        return { ok: false, latencyMs: Date.now() - start, error: 'File not found' };
      }
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
    const file = await withOrgContext(this.orgId, null, async (tx) =>
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
    opts?: ExecuteQueryOptions,
  ): Promise<QueryResult<T>> {
    // The statement runs through Drizzle/postgres.js, which has no cancel
    // API; only a pre-issued abort is honored here. The connection is
    // returned to the pool on rollback when the transaction is dropped.
    throwIfAborted(opts?.signal);
    if (query.kind !== 'spreadsheet') {
      throw new Error('Spreadsheet connector only supports spreadsheet queries');
    }
    const fileId = query.fileId || this.config.fileId;
    if (!fileId) {
      throw new Error('spreadsheet query requires fileId');
    }
    const file = await withOrgContext(this.orgId, null, async (tx) =>
      this.resolveFile(tx, fileId),
    );
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    // `validateQuery` is pure. The caller's `query` is left untouched and the
    // statement that actually runs is the one it returns — previously this
    // relied on the validator writing the LIMIT back into `query.sql`.
    const validatedSql = validateQuery(
      { kind: 'sql', sql: query.sql, params: query.params ?? [] },
      'postgres',
      this.role,
    ) ?? query.sql;

    const start = Date.now();
    const result = await withOrgContextReadOnly(file.orgId, null, async (tx) => {
      const res = await tx.execute(sql.raw(validatedSql));
      // Drizzle's postgres-js driver resolves execute() with the rows array
      // itself. The previous code read `res.rows` and fell back to `[]`, so a
      // correct result was discarded and every spreadsheet-backed dashboard
      // rendered empty — with no error anywhere.
      //
      // The `?? []` also swallowed the wrong shape silently, so a future change
      // in the driver would look like "no data" rather than a failure. An
      // unexpected shape now throws; the alert evaluator's extractValue() is
      // the in-repo precedent for treating this as an array.
      if (!Array.isArray(res)) {
        throw new Error(
          'Spreadsheet query returned an unexpected result shape from the driver',
        );
      }
      return res as T[];
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