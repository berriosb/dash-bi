# Spec: Connectors

> Sistema de conectores que permite a dash-bi leer datos de múltiples fuentes (databases + APIs REST). Define la interfaz común y la implementación de los 3 conectores P0 del MVP.

**Status:** Draft v0.2 (sync 2026-07-21)
**Prioridad:** P0 — sin conectores no hay datos
**Responsable:** codehak
**Depende de:** `multi-tenant.md`, `query-engine.md`

---

## Cambios respecto a v0.1 (sync 2026-07-21)

**v0.2 (correcciones de consistencia):**
- ✅ Agregada referencia a `query-engine.md` (donde vive la integración ejecución/validación/cache)
- ✅ Validación Postgres movida conceptualmente a `lib/security/validate-query.ts` (ya implementado en v0.1, ahora se referencia correctamente)
- ✅ Documentado TTL del schema cache (24h) + UI button "Refresh schema" + invalidación en fallo de query
- ✅ Storage del `configEncrypted` documentado: misma master key que LLM BYOK (`LLM_KEY_ENCRYPTION_KEY`)
- ❌ Removido del conector Postgres el comentario "positional queries separated by ;" duplicado (validación ya vive en `validate-query.ts`)
- ✅ Auditoría de queries agregada como sección (§ 5.4)

---

## 1. Objetivo

Permitir que cada `organization` en dash-bi:

1. **Conecte fuentes de datos via UI** sin tocar código
2. **Almacene credenciales cifradas** en DB (BYOK pattern)
3. **Consulte datos de forma uniforme** vía una interfaz común `Connector`
4. **Soporte conectores en MVP**: PostgreSQL, MySQL, Stripe API, Google Sheets, CSV/Excel (tabla tenant-scoped) y Shopify
5. **Testee la conexión** antes de guardar (UX inmediata)
6. **Liste el schema** de cada fuente (tablas/columnas para el system prompt de la IA)

## 2. Connector interface (la pieza central)

### 2.1 TypeScript interface

```typescript
// lib/connectors/types.ts

export type ConnectorType = 
  | 'postgres' 
  | 'stripe' 
  | 'sheets' 
  | 'csv' 
  | 'excel' 
  | 'spreadsheet' 
  | 'shopify' 
  | 'meta-ads' 
  | 'notion' 
  | 'mysql';

export type ConnectorConfig = {
  id: string;
  orgId: string;
  type: ConnectorType;
  name: string;                    // user-defined, ej: "Stripe producción"
  configEncrypted: string;        // JSON cifrado con credenciales
  createdAt?: Date;
  updatedAt?: Date;
};

// Cada connector implementa esta interfaz
export interface Connector {
  type: ConnectorType;
  
  // Test que la conexión funciona
  testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  
  // Lista el schema (tablas + columnas) para el system prompt
  getSchema(): Promise<ConnectorSchema>;
  
  // Ejecuta una query/operación y devuelve data
  // Para SQL connectors: ejecuta SQL
  // Para API connectors: ejecuta una operación específica
  executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>>;
}

export type ConnectorColumn = {
  name: string;
  type: string;        // 'string', 'number', 'boolean', 'date', 'datetime', 'json'
  nullable?: boolean;
  description?: string;
};

export type ConnectorTable = {
  name: string;
  description?: string;
  columns: ConnectorColumn[];
};

export type ConnectorSchema = {
  // Estructura jerárquica que se inyecta al system prompt
  tables: ConnectorTable[];
};

/**
 * Poda/Resumen de Schema para Prompts de IA (cuando la BD contiene >20 tablas).
 * Selecciona las top 15-20 tablas más relevantes basándose en coincidencia de palabras clave con el prompt
 * y relaciones de llaves foráneas para no desbordar la ventana de contexto de tokens.
 */
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

// Query discriminada por tipo de fuente
export type Query = 
  | { kind: 'sql'; sql: string; params?: unknown[] }
  | { kind: 'stripe'; operation: StripeOperation; params?: unknown }
  | { kind: 'sheets'; spreadsheetId: string; range: string }
  | { kind: 'spreadsheet'; fileId: string; sql: string; params?: unknown[] };

export type QueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
  executionTimeMs: number;
  truncated?: boolean;       // true si el resultado excedió maxRows
};
```

### 2.2 Registry pattern

```typescript
// lib/connectors/registry.ts
import { PostgresConnector } from './implementations/postgres';
import { MySQLConnector } from './implementations/mysql';
import { StripeConnector } from './implementations/stripe';
import { SheetsConnector } from './implementations/sheets';
import { SpreadsheetConnector } from './implementations/spreadsheet';
import { ShopifyConnector } from './implementations/shopify';

const registry: Record<ConnectorType, new (config: ConnectorConfig) => Connector> = {
  postgres: PostgresConnector,
  mysql: MySQLConnector,
  stripe: StripeConnector,
  sheets: SheetsConnector,
  spreadsheet: SpreadsheetConnector,
  shopify: ShopifyConnector,
  // Alias de subida de archivos que delegan en spreadsheet:
  csv: SpreadsheetConnector,
  excel: SpreadsheetConnector,
  // Fase 2:
  // 'meta-ads': MetaAdsConnector,
  // notion: NotionConnector,
};

export function createConnector(config: ConnectorConfig): Connector {
  const Ctor = registry[config.type];
  if (!Ctor) throw new Error(`Unknown connector type: ${config.type}`);
  return new Ctor(config);
}
```

## 3. Schema de DB

```typescript
// db/schema.ts

export const dataSources = pgTable('data_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id),
  
  type: text('type').$type<ConnectorType>().notNull(),
  name: text('name').notNull(),                // user-defined
  
  configEncrypted: text('config_encrypted').notNull(),  // JSON cifrado
  
  // Cache de schema (TTL 24h, invalidación manual via UI + auto on query fail)
  schemaCache: jsonb('schema_cache').$type<ConnectorSchema>(),
  schemaCachedAt: timestamp('schema_cached_at'),

  // Status
  lastTestedAt: timestamp('last_tested_at'),
  lastTestOk: boolean('last_test_ok'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const queries = pgTable('queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id),
  dataSourceId: uuid('data_source_id').notNull().references(() => dataSources.id),
  
  name: text('name'),
  query: jsonb('query').$type<Query>().notNull(),
  
  // Result cache
  lastResult: jsonb('last_result'),
  lastExecutedAt: timestamp('last_executed_at'),
  lastExecutionMs: integer('last_execution_ms'),
  
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

## 4. UI: conectar fuente de datos

### 4.1 Lista de data sources

```
┌────────────────────────────────────────────────┐
│ Data Sources                                   │
│                                                │
│ ┌──────────────────────────────────────────┐  │
│ │ ● PostgreSQL — main_db                   │  │
│ │   Connected • Schema cached 2h ago       │  │
│ │   [Test] [Refresh schema] [Configure] [×]│  │
│ └──────────────────────────────────────────┘  │
│ ┌──────────────────────────────────────────┐  │
│ │ ● Stripe — producción                    │  │
│ │   Connected • Schema cached 1d ago       │  │
│ │   [Test] [Refresh schema] [Configure] [×]│  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ [+ Add data source]                            │
└────────────────────────────────────────────────┘
```

### 4.2 Wizard de conexión (paso a paso por tipo)

**Para Postgres:**
```
Step 1: Name
  [Mi base de datos principal    ]
  
Step 2: Connection
  Host:     [db.example.com       ]
  Port:     [5432                 ]
  Database: [production           ]
  Username: [readonly_user        ]
  Password: [••••••••••          ]
  SSL:      [✓] Require SSL
  
  [Test connection]  ✓ Connected (45ms)
  
Step 3: Restrict to schemas (optional)
  [✓] public
  [ ] analytics
  [ ] _internal
  
Step 4: Confirm
  [Save] [Cancel]
```

**Para Stripe:**
```
Step 1: Name
  [Stripe producción             ]
  
Step 2: API key
  Secret key: [sk_live_...        ]
  [Test connection]  ✓ Connected
  
Step 3: Account info (auto-detected)
  Account: Acme Inc
  Country: US
  Currency: USD
```

**Para Google Sheets:**
```
Step 1: Name
  [Q3 sales tracker               ]
  
Step 2: Connect Google account
  [Connect with Google]
  → OAuth flow →  ✓ Connected as [email]
  
Step 3: Pick spreadsheet
  [📊 Q3 sales (auto-detected from Drive)]
  
Step 4: Pick sheets to expose
  [✓] Summary
  [✓] By region
  [ ] Raw data
```

## 5. Implementación: PostgreSQL connector

### 5.1 Stack

- Driver: `postgres` (porsager/postgres, mejor que `pg` para TypeScript)
- SSL obligatorio en prod
- Read-only user recomendado

### 5.2 Implementación

```typescript
// lib/connectors/implementations/postgres.ts
import postgres from 'postgres';
import { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

type PostgresConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  allowedSchemas?: string[];
};

export class PostgresConnector implements Connector {
  type = 'postgres' as const;
  private client: ReturnType<typeof postgres>;
  private config: PostgresConfig;
  
  constructor(connectorConfig: ConnectorConfig) {
    this.config = JSON.parse(decryptApiKey(connectorConfig.configEncrypted));
    this.client = postgres({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
      ssl: this.config.ssl ? 'require' : false,
      max: 5,                              // pool size
      idle_timeout: 20,
      connect_timeout: 10,
      statement_timeout: 30000,            // 30s max
      transform: { undefined: null },
    });
  }
  
  async testConnection() {
    const start = Date.now();
    try {
      await this.client`SELECT 1 as ok`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, error: error.message };
    }
  }
  
  async getSchema(): Promise<ConnectorSchema> {
    const schemas = this.config.allowedSchemas || ['public'];
    
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
  
  async executeQuery(query: Query): Promise<QueryResult> {
    if (query.kind !== 'sql') {
      throw new Error('Postgres connector only supports SQL queries');
    }
    
    // Safety: solo SELECT, no DDL/DML
    const sql = query.sql.trim();
    if (!/^(SELECT|WITH|EXPLAIN)/i.test(sql)) {
      throw new Error('Only SELECT queries are allowed');
    }
    
    const start = Date.now();
    const rows = await this.client.unsafe(sql, query.params || []);
    
    return {
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - start,
      truncated: rows.length >= 10000,
    };
  }
}

function mapPgType(pgType: string): string {
  const map: Record<string, string> = {
    'integer': 'number',
    'bigint': 'number',
    'numeric': 'number',
    'real': 'number',
    'double precision': 'number',
    'text': 'string',
    'varchar': 'string',
    'char': 'string',
    'boolean': 'boolean',
    'date': 'date',
    'timestamp': 'datetime',
    'timestamptz': 'datetime',
    'jsonb': 'json',
    'json': 'json',
    'uuid': 'string',
  };
  return map[pgType] || 'string';
}
```

### 5.3 Safety measures (crítico — defense in depth)

```typescript
// 1. Read-only enforcement
//    - Usuario de DB con permisos solo SELECT
//    - Validación en código que solo acepta SELECT/WITH/EXPLAIN (lib/security/validate-query.ts)

// 2. Query timeout
//    statement_timeout: 30000 (30s)

// 3. Row limit
//    SELECT * FROM ... LIMIT 10000  // auto-inject si no tiene LIMIT

// 4. SQL injection mitigation
//    - parameterized queries (sql template literals)
//    - Si el user pasa SQL crudo desde la UI, validar antes de ejecutar

// 5. Audit log
//    - Toda query se logea con userId, orgId, queryHash, executionTime (NO el SQL completo)
```

> **Defense in depth — verificar antes de producción:**
> - Layer 1: `validate-query.ts` (regex DML/DDL) — **implementado** en `lib/security/validate-query.ts`
> - Layer 2: Table/schema allowlist por data source — **especificado en `query-engine.md` §4**
> - Layer 3: DB user dedicado con permisos SELECT only — **configurar en `docker-compose.yml`** (script `scripts/postgres/init-readonly.sql`)
> - Layer 4: `statement_timeout: 30000` en cliente postgres — **configurar en connector**
> - Layer 5: `LIMIT 10000` auto-inject — **implementado**
> - Layer 6: SSRF Host Protection — **implementado** en `lib/security/validate-connection.ts`; aplicado en `app/api/data-sources/route.ts` (POST/PUT) y `app/api/data-sources/[id]/test/route.ts`. Valida resolución DNS para denegar rangos privados/loopback (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.169.254, ::1).

## 6. Implementación: Stripe connector

### 6.1 Stack

- SDK oficial: `stripe`
- Cache de schema (no cambia, las tablas de Stripe son fijas)
- Queries via operaciones específicas (no SQL libre)

### 6.2 Implementación

```typescript
// lib/connectors/implementations/stripe.ts
import Stripe from 'stripe';
import { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

type StripeConfig = {
  apiKey: string;     // sk_live_... o sk_test_...
  accountId?: string; // para connected accounts
};

type StripeOperation = 
  | { type: 'listCharges'; params: { created?: { gte?: number; lte?: number }; limit?: number } }
  | { type: 'listSubscriptions'; params: { status?: 'active' | 'past_due' | 'canceled'; limit?: number } }
  | { type: 'listCustomers'; params: { limit?: number } }
  | { type: 'listInvoices'; params: { created?: { gte?: number; lte?: number }; limit?: number } }
  | { type: 'getRevenue'; params: { period: 'day' | 'week' | 'month' | 'year'; count: number } };

// Schema fijo de Stripe (no se introspecta)
const STRIPE_SCHEMA: ConnectorSchema = {
  tables: [
    {
      name: 'charges',
      description: 'Pagos procesados',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'amount', type: 'number', description: 'En centavos' },
        { name: 'currency', type: 'string' },
        { name: 'status', type: 'string', description: 'succeeded, pending, failed' },
        { name: 'created', type: 'datetime' },
        { name: 'customer_id', type: 'string' },
      ],
    },
    {
      name: 'subscriptions',
      description: 'Suscripciones recurrentes',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'status', type: 'string', description: 'active, past_due, canceled, etc.' },
        { name: 'current_period_start', type: 'datetime' },
        { name: 'current_period_end', type: 'datetime' },
        { name: 'customer_id', type: 'string' },
        { name: 'plan_id', type: 'string' },
        { name: 'amount', type: 'number', description: 'En centavos' },
      ],
    },
    {
      name: 'customers',
      description: 'Clientes',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'created', type: 'datetime' },
      ],
    },
    {
      name: 'invoices',
      description: 'Facturas',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'amount_due', type: 'number', description: 'En centavos' },
        { name: 'amount_paid', type: 'number' },
        { name: 'status', type: 'string' },
        { name: 'created', type: 'datetime' },
        { name: 'customer_id', type: 'string' },
      ],
    },
  ],
};

export class StripeConnector implements Connector {
  type = 'stripe' as const;
  private client: Stripe;
  
  constructor(connectorConfig: ConnectorConfig) {
    const config = JSON.parse(decryptApiKey(connectorConfig.configEncrypted)) as StripeConfig;
    this.client = new Stripe(config.apiKey, {
      apiVersion: '2024-12-18.acacia',
    });
  }
  
  async testConnection() {
    const start = Date.now();
    try {
      await this.client.customers.list({ limit: 1 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, error: error.message };
    }
  }
  
  async getSchema(): Promise<ConnectorSchema> {
    return STRIPE_SCHEMA;
  }
  
  async executeQuery(query: Query): Promise<QueryResult> {
    if (query.kind !== 'stripe') {
      throw new Error('Stripe connector only supports stripe operations');
    }
    
    const op = query.operation;
    const start = Date.now();
    
    switch (op.type) {
      case 'listCharges': {
        const charges = await this.client.charges.list(op.params);
        return {
          rows: charges.data.map(c => ({
            id: c.id,
            amount: c.amount,
            currency: c.currency,
            status: c.status,
            created: new Date(c.created * 1000).toISOString(),
            customer_id: typeof c.customer === 'string' ? c.customer : c.customer?.id,
          })),
          rowCount: charges.data.length,
          executionTimeMs: Date.now() - start,
        };
      }
      
      case 'listSubscriptions': {
        const subs = await this.client.subscriptions.list(op.params);
        return {
          rows: subs.data.map(s => ({
            id: s.id,
            status: s.status,
            current_period_start: new Date(s.current_period_start * 1000).toISOString(),
            current_period_end: new Date(s.current_period_end * 1000).toISOString(),
            customer_id: typeof s.customer === 'string' ? s.customer : s.customer.id,
            plan_id: s.items.data[0]?.price.id,
            amount: s.items.data[0]?.price.unit_amount || 0,
          })),
          rowCount: subs.data.length,
          executionTimeMs: Date.now() - start,
        };
      }
      
      case 'listCustomers': {
        const customers = await this.client.customers.list(op.params);
        return {
          rows: customers.data.map(c => ({
            id: c.id,
            email: c.email,
            name: c.name,
            created: new Date(c.created * 1000).toISOString(),
          })),
          rowCount: customers.data.length,
          executionTimeMs: Date.now() - start,
        };
      }
      
      case 'listInvoices': {
        const invoices = await this.client.invoices.list(op.params);
        return {
          rows: invoices.data.map(i => ({
            id: i.id,
            amount_due: i.amount_due,
            amount_paid: i.amount_paid,
            status: i.status,
            created: new Date(i.created * 1000).toISOString(),
            customer_id: typeof i.customer === 'string' ? i.customer : i.customer?.id,
          })),
          rowCount: invoices.data.length,
          executionTimeMs: Date.now() - start,
        };
      }
      
      case 'getRevenue': {
        // Custom aggregation
        const now = Math.floor(Date.now() / 1000);
        const periodSeconds = {
          day: 86400,
          week: 604800,
          month: 2592000,
          year: 31536000,
        }[op.params.period];
        
        const since = now - periodSeconds * op.params.count;
        
        const charges = await this.client.charges.list({
          created: { gte: since },
          limit: 100,
        });
        
        // Aggregate by period
        const buckets = new Map<string, number>();
        for (const charge of charges.data) {
          if (charge.status !== 'succeeded') continue;
          const date = new Date(charge.created * 1000);
          const key = bucketKey(date, op.params.period);
          buckets.set(key, (buckets.get(key) || 0) + charge.amount);
        }
        
        return {
          rows: Array.from(buckets.entries()).map(([period, amount]) => ({
            period,
            amount: amount / 100,    // cents → dollars
          })).sort((a, b) => a.period.localeCompare(b.period)),
          rowCount: buckets.size,
          executionTimeMs: Date.now() - start,
        };
      }
    }
  }
}

function bucketKey(date: Date, period: 'day' | 'week' | 'month' | 'year'): string {
  switch (period) {
    case 'day': return date.toISOString().slice(0, 10);
    case 'week': {
      // ISO week
      const d = new Date(date);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    }
    case 'month': return date.toISOString().slice(0, 7);
    case 'year': return date.toISOString().slice(0, 4);
  }
}
```

## 7. Implementación: Google Sheets connector

### 7.1 Stack

- OAuth 2.0 flow (better-auth + Google provider)
- Google Sheets API v4
- Schema discovery via API

### 7.2 Implementación

```typescript
// lib/connectors/implementations/sheets.ts
import { google } from 'googleapis';
import { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

type SheetsConfig = {
  refreshTokenEncrypted: string;   // OAuth refresh token (long-lived)
  spreadsheetId: string;
  sheetNames: string[];            // user-selected sheets to expose
};

export class SheetsConnector implements Connector {
  type = 'sheets' as const;
  private sheets: ReturnType<typeof google.sheets>;
  private config: SheetsConfig;
  
  constructor(connectorConfig: ConnectorConfig) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    const config = JSON.parse(decryptApiKey(connectorConfig.configEncrypted)) as SheetsConfig;
    this.config = config;
    
    oauth2Client.setCredentials({
      refresh_token: decryptApiKey(config.refreshTokenEncrypted),
    });
    
    this.sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  }
  
  async testConnection() {
    const start = Date.now();
    try {
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId,
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, error: error.message };
    }
  }
  
  async getSchema(): Promise<ConnectorSchema> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
    });
    
    const sheets = response.data.sheets?.filter(s => 
      this.config.sheetNames.includes(s.properties?.title || '')
    ) || [];
    
    const tables = [];
    
    for (const sheet of sheets) {
      const title = sheet.properties?.title || 'Untitled';
      
      // Get first row (headers) + one data row (sample)
      const data = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${title}!A1:Z2`,
      });
      
      const rows = data.data.values || [];
      const headers = rows[0] || [];
      const sampleRow = rows[1] || [];
      
      tables.push({
        name: title,
        columns: headers.map((h, i) => ({
          name: h,
          type: inferType(sampleRow[i]),
        })),
      });
    }
    
    return { tables };
  }
  
  async executeQuery(query: Query): Promise<QueryResult> {
    if (query.kind !== 'sheets') {
      throw new Error('Sheets connector only supports sheet queries');
    }
    
    const start = Date.now();
    
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${query.spreadsheetId}!${query.range}`,
    });
    
    const rows = response.data.values || [];
    if (rows.length === 0) return { rows: [], rowCount: 0, executionTimeMs: Date.now() - start };
    
    const headers = rows[0];
    const dataRows = rows.slice(1).map(row => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? null; });
      return obj;
    });
    
    return {
      rows: dataRows,
      rowCount: dataRows.length,
      executionTimeMs: Date.now() - start,
      truncated: dataRows.length >= 10000,
    };
  }
}

function inferType(value: string | undefined): string {
  if (!value) return 'string';
  if (/^\d+$/.test(value)) return 'number';
  if (/^\d+\.\d+$/.test(value)) return 'number';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'string';
}
```

## 8. Security: cifrado de credenciales

Mismo patrón que multi-llm-router (AES-256-GCM):

```typescript
// lib/connectors/storage.ts
export async function saveDataSource(orgId: string, type: ConnectorType, name: string, config: any) {
  return db.insert(dataSources).values({
    orgId,
    type,
    name,
    configEncrypted: encryptApiKey(JSON.stringify(config)),  // AES-256-GCM via lib/security/encryption.ts
    schemaCache: null,
  });
}

export async function loadDataSourceConfig(dataSourceId: string): Promise<ConnectorConfig> {
  const row = await withOrgContext(orgId, async () =>
    db.select().from(dataSources).where(eq(dataSources.id, dataSourceId)).get()
  );
  if (!row) throw new Error('Data source not found');
  return {
    ...row,
    config: JSON.parse(decryptApiKey(row.configEncrypted)),
  };
}
```

**Master key:** misma que LLM keys (variable de entorno `LLM_KEY_ENCRYPTION_KEY`). Una sola master key cifra tanto API keys LLM como credenciales de data sources. Rotable vía key versioning (no en MVP — ver `lib/security/encryption.ts` para la interfaz).

## 9. Rate limits por connector

```typescript
const CONNECTOR_RATE_LIMITS = {
  postgres: { queriesPerMinute: 60 },
  stripe: { requestsPerMinute: 100 },     // Stripe default tier
  sheets: { requestsPerMinute: 60 },      // Google default
};
```

Implementación: token bucket per connector+org.

## 10. Acceptance criteria

Los conectores están completos cuando:

- [ ] Un usuario puede conectar PostgreSQL desde la UI con host/port/credentials
- [ ] Un usuario puede conectar Stripe pegando su API key
- [ ] Un usuario puede conectar Google Sheets via OAuth flow
- [ ] El botón "Test connection" funciona antes de guardar
- [ ] Las credenciales se guardan cifradas (AES-256-GCM)
- [ ] Las credenciales nunca aparecen en logs ni respuestas de error
- [ ] `getSchema()` devuelve tablas+columnas que se inyectan al system prompt
- [ ] `executeQuery()` ejecuta y devuelve data con tipado correcto
- [ ] Solo queries SELECT son aceptadas en Postgres (validación)
- [ ] Cada connector tiene tests unitarios con mocks
- [ ] Hay rate limiting por connector
- [ ] El usuario puede eliminar un data source desde la UI

## 11. Out of scope (MVP)

- ❌ MySQL, MongoDB, BigQuery, Snowflake, etc. (Fase 2)
- ❌ Shopify, Meta Ads, Notion, etc. (Fase 2)
- ❌ Custom connectors via UI (Fase 3)
- ❌ Data transformations / ETL
- ❌ Scheduled syncs (data siempre se lee live)
- ❌ Caching distribuido de resultados
- ❌ Data preview antes de guardar

## 12. Roadmap (post-MVP)

**Fase 2 (semana 5-6):**
- 5 conectores más (Shopify, Meta Ads, Notion, MySQL, BigQuery)
- Custom queries guardadas y reutilizables
- Data preview

**Fase 3 (semana 7-8):**
- Custom connector SDK (third-party developers pueden crear)
- Scheduled syncs + data warehouse pattern
- Data transformations (dbt-like)

## 13. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| SQL injection | Read-only user + parameterized queries + regex check |
| Credentials leak en logs | Filtros + cifrado + nunca loguear config descifrado |
| Postgres down → todo falla | Timeout 30s + circuit breaker + UI mensaje claro |
| Stripe rate limit | Token bucket + retry con backoff |
| Google OAuth token expired | Refresh token + auto-refresh + re-auth prompt si falla |
| Schema cambia → queries rotos | Cache con TTL + invalidación + warning al usuario |
| Costo de API calls (Stripe, Sheets) | Rate limit por org + alertas de gasto |

## 14. Dependencias

```json
{
  "dependencies": {
    "postgres": "^3.4.0",          // porsager/postgres
    "stripe": "^17.0.0",
    "googleapis": "^144.0.0"
  }
}
```

## 15. Specs relacionados

- `query-engine.md` — integración ejecución/validación/cache/hidratación (spec dedicado)
- `ai-generate-dashboards.md` — usa `getSchema()` para system prompt
- `widget-system.md` — `source.kind: 'query'` ejecutado vía `query-engine`
- `multi-tenant.md` — aislamiento por org
- `auth.md` — OAuth flow para Google Sheets