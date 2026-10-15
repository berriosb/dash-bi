export type ConnectorType = 'postgres' | 'stripe' | 'sheets' | 'csv' | 'excel' | 'spreadsheet' | 'shopify' | 'hubspot' | 'ga4' | 'snowflake' | 'meta-ads' | 'notion' | 'mysql';

export type ConnectorConfig = {
  id: string;
  orgId: string;
  type: ConnectorType;
  name: string;
  configEncrypted: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ConnectorColumn = {
  name: string;
  type: string; // 'string', 'number', 'boolean', 'date', 'datetime', 'json'
  nullable?: boolean;
  description?: string;
};

export type ConnectorTable = {
  name: string;
  description?: string;
  columns: ConnectorColumn[];
};

export type ConnectorSchema = {
  tables: ConnectorTable[];
};

export type StripeOperation =
  | { type: 'listCharges'; params?: { created?: { gte?: number; lte?: number }; limit?: number } }
  | { type: 'listSubscriptions'; params?: { status?: 'active' | 'past_due' | 'canceled'; limit?: number } }
  | { type: 'listCustomers'; params?: { limit?: number } }
  | { type: 'listInvoices'; params?: { created?: { gte?: number; lte?: number }; limit?: number } }
  | { type: 'getRevenue'; params: { period: 'day' | 'week' | 'month' | 'year'; count: number } };

/**
 * Sprint 1.5: a new `spreadsheet` query kind points at the schema-qualified
 * Postgres table backing an `uploaded_files` row. The AI Gateway
 * generates `sql: 'SELECT ... FROM <targetTable> WHERE ...'` based on the
 * column schema; we run it via the postgres connector's validation
 * path. The `kind: 'spreadsheet'` marker tells the connector to load
 * the schema for the right file before running the query.
 */
export type GA4Query = {
  kind: 'ga4';
  metrics: string[];
  dimensions?: string[];
  dateRange: { startDate: string; endDate: string };
  limit?: number;
};

export type Query =
  | { kind: 'sql'; sql: string; params?: unknown[] }
  | { kind: 'stripe'; operation: StripeOperation; params?: unknown }
  | { kind: 'sheets'; spreadsheetId: string; range: string }
  | { kind: 'spreadsheet'; fileId: string; sql: string; params?: unknown[] }
  | GA4Query;

export type QueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
  executionTimeMs: number;
  truncated?: boolean;
};

export interface ExecuteQueryOptions {
  /**
   * Cancellation signal, aborted by `executeWithTimeout` when the deadline
   * passes.
   *
   * Implementations MUST honor it in whatever way the underlying driver
   * allows, and MUST reject with the signal's `reason` once aborted rather
   * than resolving with a partial result. Drivers that cannot interrupt an
   * in-flight statement (postgres.js 3.x has no cancel API) may only check
   * `signal.aborted` before issuing — documented per implementation.
   */
  signal?: AbortSignal;

  /**
   * The caller's deadline in milliseconds.
   *
   * Distinct from `signal`: some SDKs (stripe-node) can only bound a
   * request with a timeout and have no way to observe an AbortSignal, so
   * they use this instead. Connectors that can do real cancellation should
   * use `signal`.
   */
  timeoutMs?: number;
}

export interface Connector {
  type: ConnectorType;
  testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  getSchema(): Promise<ConnectorSchema>;
  executeQuery<T = Record<string, unknown>>(
    query: Query,
    opts?: ExecuteQueryOptions,
  ): Promise<QueryResult<T>>;
}

/**
 * Rejects with the signal's reason when the signal is already aborted, so a
 * caller can short-circuit before touching the network or the pool.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Query aborted');
  }
}

export function pruneSchemaForPrompt(schema: ConnectorSchema, userPrompt: string, maxTables = 15): ConnectorSchema {
  if (!schema.tables || schema.tables.length <= maxTables) return schema;
  const keywords = userPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scored = schema.tables.map(table => {
    let score = 0;
    const tableName = table.name.toLowerCase();
    keywords.forEach(kw => { if (tableName.includes(kw)) score += 10; });
    table.columns.forEach(col => {
      keywords.forEach(kw => { if (col.name.toLowerCase().includes(kw)) score += 2; });
    });
    return { table, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return { tables: scored.slice(0, maxTables).map(s => s.table) };
}
