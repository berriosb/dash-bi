import postgres from 'postgres';
import { decryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

export type PostgresConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  allowedSchemas?: string[];
};

export class PostgresConnector implements Connector {
  type = 'postgres' as const;
  private client: ReturnType<typeof postgres>;
  private config: PostgresConfig;

  constructor(connectorConfig: ConnectorConfig) {
    const rawConfig = decryptApiKey(connectorConfig.configEncrypted);
    this.config = JSON.parse(rawConfig);
    this.client = postgres({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
      ssl: this.config.ssl ? 'require' : false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      transform: { undefined: null },
    });
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.client`SELECT 1 as ok`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, error: msg };
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    const schemas = this.config.allowedSchemas?.length ? this.config.allowedSchemas : ['public'];

    const tables = await this.client<{ table_name: string; table_schema: string }[]>`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = ANY(${schemas}) 
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `;

    const result: ConnectorSchema = { tables: [] };

    for (const t of tables) {
      const columns = await this.client<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[]>`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${t.table_schema} AND table_name = ${t.table_name}
        ORDER BY ordinal_position
      `;

      result.tables.push({
        name: `${t.table_schema}.${t.table_name}`,
        columns: columns.map(c => ({
          name: c.column_name,
          type: mapPgType(c.data_type),
          nullable: c.is_nullable === 'YES',
        })),
      });
    }

    return result;
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    if (query.kind !== 'sql') {
      throw new Error('Postgres connector only supports SQL queries');
    }

    // Safety validation
    validateQuery(query, 'postgres');

    const start = Date.now();
    const sqlStr = query.sql;
    const params = (query.params as unknown[]) || [];

    const rows = await this.client.unsafe(sqlStr, params as never[]);

    return {
      rows: Array.from(rows) as T[],
      rowCount: rows.length,
      executionTimeMs: Date.now() - start,
      truncated: rows.length >= 10000,
    };
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

function mapPgType(pgType: string): string {
  const map: Record<string, string> = {
    integer: 'number',
    bigint: 'number',
    numeric: 'number',
    real: 'number',
    'double precision': 'number',
    text: 'string',
    varchar: 'string',
    char: 'string',
    boolean: 'boolean',
    date: 'date',
    timestamp: 'datetime',
    timestamptz: 'datetime',
    jsonb: 'json',
    json: 'json',
    uuid: 'string',
  };
  return map[pgType.toLowerCase()] || 'string';
}
