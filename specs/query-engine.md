# Spec: Query Engine

> Pipeline end-to-end que ejecuta las queries generadas por la IA (o escritas manualmente) contra los data sources conectados. Define cómo se hidrata cada widget con datos reales.

**Status:** Draft v0.1
**Prioridad:** P0 — feature estrella depende de esto
**Responsable:** codehak
**Depende de:** `connectors.md`, `widget-system.md`, `ai-generate-dashboards.md`
**Relacionado:** `docs/security/threat-model.md` (T2 SQL injection)

---

## 1. Objetivo

Dado un `Widget` con `source.kind: 'query'`, el query engine debe:

1. **Resolver el connector** para el `dataSourceId` referenciado
2. **Validar la query** según las reglas del connector (read-only, sintaxis, scope)
3. **Ejecutar la query** con timeouts, retries, cancelación
4. **Cachear el resultado** con TTL configurable y key por tenant
5. **Mapear el resultado** al shape esperado por el widget
6. **Reportar errores** con contexto suficiente para debug sin filtrar secrets
7. **Hidratar el widget** con los datos para el render

Garantías:
- Aislamiento por tenant (`orgId` siempre presente en cache key y ejecución)
- Si la query falla, el widget muestra estado de error pero no rompe el dashboard
- Latency budget: p95 <2s para queries simples (Postgres, Stripe API call)

---

## 2. Pipeline completo

```
Widget { source: { kind: 'query', dataSourceId, query } }
        │
        ▼
[1] resolveConnector(orgId, dataSourceId)
        │
        ▼
[2] validateQuery(query, connectorType)   ← lib/security/validate-query.ts
        │
        ▼ (inválido → throw ValidationError → widget error state)
        │
[3] cacheKey(orgId, dataSourceId, queryHash)   ← SHA-256 del query canónico
        │
        ├── cache hit (TTL vigente) ──→ return QueryResult cached
        │
        ▼
[4] executeWithTimeout(connector, query, { timeoutMs: 30000, retries: 1 })
        │
        ├── timeout ──→ circuit breaker counter++
        ├── retry ──→ execute (si retries > 0)
        └── error   ──→ log + return QueryResult { rows: [], error: ... }
        │
        ▼
[5] cacheSet(key, result, ttlSeconds)
        │
        ▼
[6] mapWidgetData(widget.type, result.rows) → shape esperado por el widget
        │
        ▼
Widget { ...widget, data: hydrated }
```

---

## 3. Resolver el connector

```typescript
// lib/query-engine/resolve.ts

export async function resolveConnector(
  orgId: string,
  dataSourceId: string,
  role: OrgRole  // ver multi-tenant.md §3.3 — viene de withOrgContext
): Promise<Connector> {
  const ds = await withOrgContext(orgId, role, async () => {
    return db.query.dataSources.findFirst({
      where: and(
        eq(dataSources.id, dataSourceId),
        eq(dataSources.orgId, orgId)
      ),
    });
  });

  if (!ds) throw new DataSourceNotFoundError(dataSourceId);

  // Viewer no puede ejecutar queries destructivas (defense in depth,
  // aunque validateQuery ya bloquea DML/DDL, capa adicional por rol)
  if (role === 'viewer') {
    // No-op aquí, pero `validateQuery` consulta `app.current_user_role`
    // y rechaza `INSERT/UPDATE/DELETE` por rol (no solo por regex)
  }

  const config = JSON.parse(decryptApiKey(ds.configEncrypted));
  return createConnector({
    id: ds.id,
    orgId: ds.orgId,
    type: ds.type,
    name: ds.name,
    configEncrypted: ds.configEncrypted,
    config,  // decrypted only for this in-memory connection, never logged
    role,   // el connector puede aplicar filtros adicionales (ej: row-level)
  });
}
```

Restricciones:
- Resolver SIEMPRE dentro de `withOrgContext(orgId, role, fn)` para que RLS valide la org y el rol esté disponible vía `current_setting('app.current_user_role')`
- `config` descifrado solo vive en memoria local del request, nunca se loguea
- `role` se propaga al connector para aplicar filtros row-level en `viewer` (no solo regex DML/DDL)
- Si el connector está caído (3 fallos consecutivos), circuit breaker abierto

---

## 4. Validación de queries

La validación ya está implementada parcialmente en `app/src/lib/security/validate-query.ts`. Esta sección define la integración con el query engine.

```typescript
// lib/query-engine/validate.ts

import { validateQuery as baseValidate } from '@/lib/security/validate-query';

export function validate(query: Query, connectorType: ConnectorType, dsConfig: DataSourceConfig, role: OrgRole): void {
  baseValidate(query, connectorType);

  if (connectorType === 'postgres') {
    assertTableAllowed(query.sql, dsConfig.allowedSchemas ?? ['public']);
    assertNoSystemSchemas(query.sql);
    assertRolePermissions(query.sql, role);  // viewer solo SELECT sobre tablas permitidas
  }

  if (connectorType === 'stripe') {
    assertOperationAllowed(query.operation);
    assertStripeRolePermissions(query.operation, role);  // viewer no puede listar customers PII
  }

  if (connectorType === 'sheets') {
    assertRangeAllowed(query.spreadsheetId, query.range, dsConfig.sheetNames);
  }
}

/**
 * Filtros row-level por rol (defense in depth, además de RLS).
 * El viewer:
 *   - Solo puede SELECT (ya cubierto por baseValidate)
 *   - Solo sobre tablas del allowlist (ya cubierto por assertTableAllowed)
 *   - Sin acceso a columnas sensibles marcadas (PII masking)
 */
function assertRolePermissions(sql: string, role: OrgRole): void {
  if (role !== 'viewer') return;
  
  // Lista negra de columnas sensibles que el viewer no puede SELECT
  const SENSITIVE_COLUMNS = /\b(password|secret|api_key|token|ssn|tax_id)\b/i;
  if (SENSITIVE_COLUMNS.test(sql)) {
    throw new ValidationError('Role viewer cannot access sensitive columns');
  }
}

function assertStripeRolePermissions(operation: StripeOperation, role: OrgRole): void {
  if (role !== 'viewer') return;
  
  // Viewer no puede listar customers (PII: email, name)
  if (operation.type === 'listCustomers') {
    throw new ValidationError('Role viewer cannot list customers');
  }
}

function assertTableAllowed(sql: string, schemas: string[]): void {
  const referencedTables = extractTableNames(sql);
  for (const table of referencedTables) {
    const schema = table.split('.')[0] ?? 'public';
    if (!schemas.includes(schema)) {
      throw new ValidationError(`Schema "${schema}" not in allowlist: ${schemas.join(', ')}`);
    }
  }
}
```

Defense in depth:
- **Layer 1:** `validate-query.ts` bloquea DML/DDL/stacked queries
- **Layer 2:** Tabla/schema allowlist por data source
- **Layer 3:** DB user dedicado con permisos `SELECT` solo (configurado en docker-compose)
- **Layer 4:** `statement_timeout: 30000` en el cliente postgres
- **Layer 5:** `LIMIT 10000` auto-inject

---

## 5. Cache de resultados

### 5.1 Estrategia

- **Key:** `query:{orgId}:{dataSourceId}:{queryHash}` donde `queryHash` es SHA-256 del JSON canónico del query
- **TTL:** 60 segundos default, configurable por widget type (KPI: 5min, charts: 60s, tables: 30s)
- **Invalidación:** al guardar dashboard (`dashboards.updated`) se invalidan todas las keys del dashboard
- **Storage:** Redis si está disponible (docker-compose incluye Redis), fallback a memoria (LRU 1MB) si no

```typescript
// lib/query-engine/cache.ts

type CacheEntry = {
  result: QueryResult;
  cachedAt: number;
};

export async function cacheGet(key: string): Promise<QueryResult | null> {
  if (redis) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return memoryCache.get(key) ?? null;
}

export async function cacheSet(key: string, result: QueryResult, ttlSeconds: number): Promise<void> {
  if (redis) {
    await redis.set(key, JSON.stringify(result), 'EX', ttlSeconds);
  } else {
    memoryCache.set(key, result, ttlSeconds * 1000);
  }
}
```

### 5.2 Cache key canónica

```typescript
function canonicalQueryKey(orgId: string, dataSourceId: string, query: Query): string {
  return `query:${orgId}:${dataSourceId}:${sha256(stableStringify(query))}`;
}

/**
 * Serializa un objeto a JSON con keys ordenadas recursivamente.
 * 
 * IMPORTANTE: la implementación debe ordenar keys en TODOS los niveles, no solo
 * el top-level. Si no, queries equivalentes con keys en distinto orden producen
 * hashes distintos y rompen cache hits.
 * 
 * Ejemplo del bug si NO fuera recursivo:
 *   Query A: { kind: 'sql', sql: 'SELECT 1', params: [{ name: 'x', value: 1 }] }
 *   Query B: { kind: 'sql', sql: 'SELECT 1', params: [{ value: 1, name: 'x' }] }
 * 
 *   stableStringify top-level sort:
 *     A → '{"kind":"sql","params":[...],"sql":"SELECT 1"}'  (params interno sin ordenar)
 *     B → '{"kind":"sql","params":[...],"sql":"SELECT 1"}'  (mismo hash si solo top-level sort, PERO)
 * 
 *   Si params se construye como objeto literal con keys en distinto orden:
 *     A.params → '{"name":"x","value":1}' (orden A)
 *     B.params → '{"value":1,"name":"x"}' (orden B)
 *   → hash distinto, cache miss innecesario.
 * 
 * Por eso, recursivo es obligatorio.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as object).sort();
  return '{' + keys.map(k => 
    JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])
  ).join(',') + '}';
}
```

Importante: el cache key incluye SIEMPRE `orgId` (`query:{orgId}:{dataSourceId}:{hash}`) para garantizar aislamiento estricto multi-tenant y evitar colisiones cross-tenant en Redis. El `stableStringify` recursivo es **obligatorio** para garantizar que queries equivalentes (mismo SQL, mismas tablas, mismos params en cualquier orden) produzcan el mismo hash y reutilicen el cache.

---

## 6. Ejecución con timeout y retries

```typescript
// lib/query-engine/execute.ts

export async function executeWithTimeout(
  connector: Connector,
  query: Query,
  opts: { timeoutMs: number; retries: number }
): Promise<QueryResult> {
  const start = Date.now();

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const result = await Promise.race([
        connector.executeQuery(query),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new QueryTimeoutError()), opts.timeoutMs)
        ),
      ]);
      return { ...result, executionTimeMs: Date.now() - start };
    } catch (error) {
      if (error instanceof QueryTimeoutError && attempt < opts.retries) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('unreachable');
}
```

### 6.1 Circuit breaker

Si un connector falla 3 veces en 60 segundos, abrir el breaker por 5 minutos:

```typescript
// lib/query-engine/circuit-breaker.ts

const breakers = new Map<string, { failures: number; openedAt: number }>();

export function recordFailure(connectorId: string) {
  const state = breakers.get(connectorId) ?? { failures: 0, openedAt: 0 };
  state.failures += 1;
  if (state.failures >= 3 && Date.now() - state.openedAt > 5 * 60 * 1000) {
    state.openedAt = Date.now();
    log.warn(`Circuit breaker OPEN for connector ${connectorId}`);
  }
  breakers.set(connectorId, state);
}

export function isOpen(connectorId: string): boolean {
  const state = breakers.get(connectorId);
  if (!state) return false;
  if (Date.now() - state.openedAt < 5 * 60 * 1000) return true;
  state.failures = 0;
  state.openedAt = 0;
  return false;
}
```

---

## 7. Hidratación del widget

Cada widget type espera un `data` shape específico. El query engine mapea `result.rows` (genérico) al shape esperado.

```typescript
// lib/query-engine/hydrate.ts

export function hydrateWidget(widget: Widget, result: QueryResult): Widget {
  switch (widget.type) {
    case 'kpi':
      return hydrateKpi(widget, result);
    case 'line-chart':
      return hydrateLineChart(widget, result);
    case 'bar-chart':
      return hydrateBarChart(widget, result);
    case 'pie-chart':
      return hydratePieChart(widget, result);
    case 'area-chart':
      return hydrateAreaChart(widget, result);
    case 'scatter':
      return hydrateScatter(widget, result);
    case 'table':
      return hydrateTable(widget, result);
  }
}

function hydrateKpi(widget: KPIWidget, result: QueryResult): KPIWidget {
  const row = result.rows[0] ?? {};
  // Extraer el primer valor numérico disponible si la query no usó el alias "value"
  const inferredValue = row.value ?? Object.values(row).find(v => typeof v === 'number' || !isNaN(Number(v))) ?? 0;
  return {
    ...widget,
    data: {
      value: Number(inferredValue),
      delta: row.delta !== undefined ? Number(row.delta) : undefined,
      target: row.target !== undefined ? Number(row.target) : undefined,
    },
  };
}

// Mappers para chart types documentados en `widget-system.md` §3.2
```

Mappers específicos por widget type (no se documentan aquí por brevedad — ver `widget-system.md` §3.2 para shapes esperados).

---

## 8. Manejo de errores

```typescript
// lib/query-engine/errors.ts

export type EngineError =
  | { kind: 'validation'; message: string; field?: string }
  | { kind: 'timeout'; connectorId: string; timeoutMs: number }
  | { kind: 'connector_down'; connectorId: string; statusCode?: number }
  | { kind: 'forbidden'; message: string }   // RLS / table allowlist
  | { kind: 'unknown'; message: string };

export function toWidgetError(error: unknown): WidgetErrorState {
  if (error instanceof ValidationError) return { kind: 'validation', message: error.message };
  if (error instanceof QueryTimeoutError) return { kind: 'timeout', message: 'Query excedió el tiempo máximo' };
  if (error instanceof DataSourceNotFoundError) return { kind: 'connector_down', message: 'Fuente de datos no encontrada' };
  // ... etc
  return { kind: 'unknown', message: 'Error desconocido al ejecutar la query' };
}
```

### 8.1 Estado de error en el widget

El widget NO desaparece si la query falla. Se renderiza con error state:

```
┌─────────────────────────────┐
│ Revenue                     │
│ ⚠ No se pudo cargar         │
│   Table "invoices" not found│
│   [Reintentar]              │
└─────────────────────────────┘
```

El error message es user-friendly (mapeado a español) sin exponer stack traces, pero tiene `correlation ID` para support.

---

## 9. Ejecución paralela por dashboard

Cuando un dashboard tiene N widgets con queries, se ejecutan en paralelo con `Promise.allSettled` (para que un fallo no cancele el resto):

```typescript
// lib/query-engine/dashboard.ts

export async function hydrateDashboard(
  orgId: string,
  widgets: Widget[]
): Promise<HydratedWidget[]> {
  const results = await Promise.allSettled(
    widgets.map((w) => hydrateWidgetFromQuery(orgId, w))
  );

  return widgets.map((widget, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') return r.value;
    return {
      ...widget,
      data: null,
      error: toWidgetError(r.reason),
    };
  });
}
```

Budget total end-to-end:
- LLM round-trip: 3-5s
- Queries en paralelo: p95 <2s (si Redis cache hit, <100ms)
- Render + serialización: <500ms
- **Total: <8s p50, <12s p95**

---

## 10. Refresh strategy

Tres modos por widget:

| Mode | Comportamiento | Default para |
|------|---------------|--------------|
| `live` | Re-ejecuta cada vez que se monta | Tablas en dashboards operativos |
| `cached-ttl` | Cache con TTL (configurable) | KPIs y charts en dashboards |
| `manual` | Solo al click de "Refresh" | Dashboards compartidos con link público |

Config por widget:
```typescript
type Widget = {
  // ...
  source: DataSource & {
    refresh?: {
      mode: 'live' | 'cached-ttl' | 'manual';
      ttlSeconds?: number;  // default 60
    };
  };
};
```

Default en MVP: `cached-ttl` con TTL 60 segundos para todos los widgets.

---

## 11. Logging y observability

Cada ejecución emite:

```typescript
{
  event: 'query.executed',
  orgId,
  dataSourceId,
  connectorType,
  queryHash,
  executionTimeMs,
  rowsReturned: number,
  cacheHit: boolean,
  errorKind?: string,
  errorMessage?: string,
}
```

Esto va a Pino (estructurado, redactado) con `org_id` y `queryHash` — nunca el SQL completo. SQL solo se loguea a nivel debug, con el logger redactando secrets.

Métricas Prometheus (opentelemetry):
- `query_engine_executions_total{connector, status}`
- `query_engine_duration_ms{connector, status}`
- `query_engine_cache_hits_total{connector}`
- `query_engine_circuit_breaker_state{connector}`

---

## 12. Tests obligatorios (P0)

```typescript
describe('Query Engine', () => {
  describe('Tenant isolation', () => {
    it('cross-tenant query returns empty', async () => { ... });
    it('rejects cross-tenant dataSourceId', async () => { ... });
  });

  describe('Validation', () => {
    it('rejects DROP TABLE', async () => { ... });
    it('auto-injects LIMIT', async () => { ... });
    it('rejects table outside allowlist', async () => { ... });
  });

  describe('Cache', () => {
    it('cache hit returns same result without re-execution', async () => { ... });
    it('cache invalidation on dashboard update', async () => { ... });
    it('different orgs have separate cache', async () => { ... });
  });

  describe('Execution', () => {
    it('respects timeout', async () => { ... });
    it('retries on transient failure', async () => { ... });
    it('circuit breaker opens after 3 failures', async () => { ... });
  });

  describe('Hydration', () => {
    it('kpi widget gets value from rows[0].value', async () => { ... });
    it('line-chart widget maps rows to series', async () => { ... });
    it('failing widget shows error state, not crash', async () => { ... });
  });

  describe('Error handling', () => {
    it('rejects SQL with forbidden keyword', async () => { ... });
    it('handles connector down gracefully', async () => { ... });
    it('does not leak secrets in error messages', async () => { ... });
  });
});
```

Tests usan Testcontainers Postgres + mocks para Stripe/Sheets.

---

## 13. Acceptance criteria

- [ ] Widget con `source.kind: 'query'` se hidrata con data real al renderizar
- [ ] Todas las queries pasan por `validateQuery()` antes de ejecutar
- [ ] DB user de la app solo tiene permisos SELECT (defense in depth)
- [ ] Cache hit devuelve resultado sin re-ejecutar la query
- [ ] Cache key incluye `queryHash` canónico (mismo query → mismo cache)
- [ ] Cache namespace incluye `orgId` (sin colisiones cross-tenant)
- [ ] Query que excede 30s timeout no bloquea el dashboard
- [ ] Circuit breaker abre después de 3 fallos del mismo connector
- [ ] Query que falla muestra error state en el widget (no rompe el dashboard)
- [ ] Queries paralelas en dashboard con N widgets: p95 <2s cuando todas cache hit
- [ ] Cada ejecución emite log estructurado con `queryHash` (no SQL completo)
- [ ] `dashboard.updated` invalida cache de todas las widgets del dashboard
- [ ] Tests de seguridad (P0 del threat model) pasan
- [ ] Tests de hidratación para los 7 widget types

---

## 14. Out of scope (MVP)

- ❌ Materialized views o pre-aggregation (Fase 2)
- ❌ Streaming de resultados para queries largos (Fase 2)
- ❌ Query savings explorer (ver queries más lentas) (Fase 2)
- ❌ Custom refresh intervals por widget via UI (Fase 2)
- ❌ Query versioning / diff entre versiones (Fase 3)

---

## 15. Roadmap

**Fase 2 (semana 7-8):**
- Pre-aggregation layer para queries pesadas
- Query plan visualization para Postgres
- Custom TTL por widget via UI
- Cache warming en background job

**Fase 3 (semana 11-12):**
- Query versioning con diff entre versiones
- Semantic caching (queries similares → mismo cache)
- Query cost estimation antes de ejecutar

---

## 16. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| SQL injection rompe la DB | 5 layers de defensa (regex + table allowlist + DB user SELECT-only + statement_timeout + LIMIT auto-inject) |
| Query tarda 30s y bloquea dashboard | Timeout en Promise.race + circuit breaker |
| Cache hit devuelve datos de otro tenant | Cache key namespace por orgId + tests de aislamiento |
| LLM genera queries caras | Rate limit por org + cost tracking en `llm_usage` |
| Connector caído → UX fea | Error state en widget + retry button + circuit breaker log |
| Schema del data source cambió | TTL de 60s (no real-time stale data) + refresh schema UI manual |

---

## 17. Especificaciones relacionadas

- `connectors.md` — define `Connector` interface y los 3 connectors MVP
- `widget-system.md` — shape de `source.kind: 'query'` y shape de `data` por widget
- `ai-generate-dashboards.md` — la IA genera el query, este spec lo ejecuta
- `multi-tenant.md` — `withOrgContext()` enforcement
- `docs/security/threat-model.md` — T2 SQL injection prevention
