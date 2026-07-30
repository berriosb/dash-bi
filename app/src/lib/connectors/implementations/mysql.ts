import mysql from 'mysql2/promise';
import { decryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';
import { validatePostgresHost, SSRFError } from '@/lib/security/validate-connection';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

export type MysqlConfig = {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
};

export class MysqlConnector implements Connector {
  type = 'mysql' as const;
  private pool: mysql.Pool;
  private config: MysqlConfig;

  constructor(connectorConfig: ConnectorConfig) {
    const rawConfig = decryptApiKey(connectorConfig.configEncrypted);
    this.config = JSON.parse(rawConfig);

    try {
      validatePostgresHost(this.config.host);
    } catch (err) {
      if (err instanceof SSRFError) {
        throw err;
      }
      throw new SSRFError(`Invalid MySQL host: ${(err as Error).message}`);
    }

    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port ?? 3306,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 5,
      connectTimeout: 10000,
    });
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1 as ok');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, error: msg };
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    const [tablesRows] = (await this.pool.query(
      `SELECT table_name, table_comment FROM information_schema.tables WHERE table_schema = ?`,
      [this.config.database],
    )) as unknown as [Array<{ table_name: string; table_comment?: string }>];

    const [columnsRows] = (await this.pool.query(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = ?`,
      [this.config.database],
    )) as unknown as [Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>];

    const columnsByTable = new Map<string, Array<{ name: string; type: string; nullable: boolean }>>();

    for (const col of columnsRows) {
      const existing = columnsByTable.get(col.table_name) ?? [];
      existing.push({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
      });
      columnsByTable.set(col.table_name, existing);
    }

    const tables = tablesRows.map((t) => ({
      name: t.table_name,
      description: t.table_comment || undefined,
      columns: columnsByTable.get(t.table_name) ?? [],
    }));

    return { tables };
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    if (query.kind !== 'sql') {
      throw new Error('MySQL connector expects SQL query');
    }

    validateQuery(query, 'mysql');

    const start = Date.now();
    const [rows] = (await this.pool.query(query.sql, query.params ?? [])) as unknown as [T[]];
    const executionTimeMs = Date.now() - start;

    const rowArray = Array.isArray(rows) ? rows : [];

    return {
      rows: rowArray,
      rowCount: rowArray.length,
      executionTimeMs,
    };
  }
}
