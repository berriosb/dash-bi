import mysql from 'mysql2/promise';
import { decryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';
import { validatePostgresHost, SSRFError } from '@/lib/security/validate-connection';
import { throwIfAborted } from '../types';
import type { Connector, ConnectorConfig, ConnectorSchema, ExecuteQueryOptions,
  Query, QueryResult } from '../types';

export type MysqlConfig = {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
};

const MAX_CACHED_POOLS = 50;
const mysqlPools = new Map<string, mysql.Pool>();

function getOrCreateMysqlPool(key: string, config: MysqlConfig): mysql.Pool {
  const existing = mysqlPools.get(key);
  if (existing) return existing;

  if (mysqlPools.size >= MAX_CACHED_POOLS) {
    const oldestKey = mysqlPools.keys().next().value;
    if (oldestKey) {
      const oldestPool = mysqlPools.get(oldestKey);
      mysqlPools.delete(oldestKey);
      void oldestPool?.end().catch(() => {});
    }
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port ?? 3306,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 5,
    connectTimeout: 10000,
    idleTimeout: 20000,
  });
  mysqlPools.set(key, pool);
  return pool;
}

export class MysqlConnector implements Connector {
  type = 'mysql' as const;
  private pool: mysql.Pool;
  private config: MysqlConfig;
  private poolKey: string;

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

    this.poolKey = `${connectorConfig.id}:${connectorConfig.configEncrypted}`;
    this.pool = getOrCreateMysqlPool(this.poolKey, this.config);
  }

  async close(): Promise<void> {
    mysqlPools.delete(this.poolKey);
    await this.pool.end();
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

  async executeQuery<T = Record<string, unknown>>(
    query: Query,
    opts?: ExecuteQueryOptions,
  ): Promise<QueryResult<T>> {
    // mysql2 has no portable cancel for a running statement on a pooled
    // connection; the signal is honored only before the query is issued.
    throwIfAborted(opts?.signal);
    if (query.kind !== 'sql') {
      throw new Error('MySQL connector expects SQL query');
    }

    // `validateQuery` is pure; the normalized SQL (LIMIT injected or clamped)
    // is what has to reach the driver.
    const sqlStr = validateQuery(query, 'mysql') ?? query.sql;

    const start = Date.now();
    const [rows] = (await this.pool.query(sqlStr, query.params ?? [])) as unknown as [T[]];
    const executionTimeMs = Date.now() - start;

    const rowArray = Array.isArray(rows) ? rows : [];

    return {
      rows: rowArray,
      rowCount: rowArray.length,
      executionTimeMs,
    };
  }
}
