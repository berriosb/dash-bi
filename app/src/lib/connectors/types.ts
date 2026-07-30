export type ConnectorType = 'postgres' | 'stripe' | 'sheets' | 'csv' | 'excel' | 'spreadsheet' | 'shopify' | 'meta-ads' | 'notion' | 'mysql';

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
export type Query =
  | { kind: 'sql'; sql: string; params?: unknown[] }
  | { kind: 'stripe'; operation: StripeOperation; params?: unknown }
  | { kind: 'sheets'; spreadsheetId: string; range: string }
  | { kind: 'spreadsheet'; fileId: string; sql: string; params?: unknown[] };

export type QueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
  executionTimeMs: number;
  truncated?: boolean;
};

export interface Connector {
  type: ConnectorType;
  testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  getSchema(): Promise<ConnectorSchema>;
  executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>>;
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
