# Spec: AI-Generate Dashboards

> Feature estrella de dash-bi. La IA compone dashboards completos desde prompts en lenguaje natural. **Datos REALES del data source conectado** — no datos ficticios. **8 archetypes curados** + variación combinatoria garantizan que cada dashboard se vea distinto.

**Status:** Draft v0.4 (sync 2026-07-21 — design diversity)
**Prioridad:** P0 — feature diferenciador
**Responsable:** codehak
**Depende de:** `widget-system.md`, `multi-llm-router.md`, `connectors.md`, `query-engine.md`, `dashboard-archetypes.md`

---

## Cambios respecto a v0.3

**Sync v0.4 — design diversity:**
- ✅ Nueva dependencia: `specs/dashboard-archetypes.md` (8 archetypes + 7 patrones atómicos + 4 axes de variación)
- ✅ El sistema prompt de §6 ahora inyecta las reglas de variedad + atomic patterns (no más "kpi-row + 2 charts + tabla" como default)
- ✅ Schema del Dashboard extendido con `archetype` + `archetypeVariant` (opcionales pero auto-set por la IA)
- ✅ User puede pedir **"3 variaciones distintas"** y la IA genera 3 dashboards con archetypes distintos

**Sync v0.3:**
- ✅ Referencia a `specs/query-engine.md` como spec dedicado del pipeline de ejecución/validación/cache (gap crítico del audit resuelto)
- ❌ Eliminadas menciones a 5 LLM providers y a `minimax` (ver `multi-llm-router.md` v0.3)
- ✅ Confirmado: 7 widgets (no 8 ni 10)
- ✅ Confirmado: 3 LLM providers (OpenAI, Anthropic, Gemini)
- ✅ Confirmado: Puppeteer en worker PDF separado (ver `export.md` §3)

**Decisiones aplicadas (v0.2 post-auditoría):**
- ❌ Eliminado: `source.kind: 'inline'` con data hardcodeada. Era teatro.
- ✅ Nuevo: la IA genera SQL/API call → se ejecuta → datos reales.
- ❌ Eliminado: fallback template estático. Reemplazado por error claro + retry guiado.
- ✅ Nuevo: query validation pipeline (read-only check, syntax, permissions).
- ❌ Eliminado: el spec asumía 5 LLM providers. Ahora 3 (OpenAI, Anthropic, Gemini).

---

## 1. Objetivo

Permitir que un usuario sin conocimiento técnico genere un dashboard completo escribiendo UN SOLO prompt en lenguaje natural, donde:

1. **Los widgets se renderizan con datos REALES** del data source conectado
2. **Se renderice en <8 segundos** (incluye el round-trip al LLM + query execution)
3. **Use los 7 tipos de widget** definidos en `widget-system.md`
4. **Responda a contexto del schema** — la IA sabe qué tablas/columnas existen
5. **Sea editable iterativamente** — el usuario puede pedir cambios via chat
6. **Use el provider LLM configurado por la org** — switch entre 3 providers sin redeploy

---

## 2. Flujo UX end-to-end

### 2.1 Crear dashboard nuevo

```
1. Usuario hace login → Dashboard → "Nuevo dashboard"
2. Aparece chat panel (sticky, lado derecho)
3. Chat vacío con prompt sugerido contextual al data source
4. Usuario escribe (o dicta) su prompt
5. Click "Generar" o Enter
6. Loading state: "Analizando tu data..." (skeleton del grid)
7. ~3-8 segundos → Dashboard renderizado con datos REALES
8. Chat ahora muestra: "Listo. ¿Quieres ajustar algo?"
9. Usuario puede seguir chateando para refinar
```

### 2.2 Edit iterativo

```
1. Usuario ve dashboard generado
2. Quiere un cambio: "agregale un bar chart por país"
3. Click "Pedir cambio" en el chat
4. IA analiza el JSON actual + nuevo prompt
5. Devuelve JSON actualizado (mismo `dashboardId`, nueva versión)
6. Dashboard se actualiza in-place con animación de transición
7. Versiones se guardan en historial (rollback disponible)
```

---

## 3. Arquitectura: prompt → dashboard real

### 3.1 Pipeline end-to-end

```
Usuario escribe prompt
        ↓
[1] ChatPanel → POST /api/dashboards/generate
        ↓
[2] API valida auth + quota + rate limit
        ↓
[3] Construye system prompt con schema del data source
        ↓
[4] LLM devuelve JSON con widgets + QUERIES (no data)
        ↓
[5] Validator: Zod check del JSON
        ↓
[6] Si falla: retry con error feedback (max 3)
        ↓
[7] Para cada widget: ejecuta query real via connector
        ↓
[8] Inyecta resultados en widget data
        ↓
[9] Guarda dashboard en DB
        ↓
[10] Devuelve dashboard renderizado al cliente
```

### 3.2 Cambio clave en el JSON schema del widget

**Antes (v0.1, teatro):**
```json
{
  "type": "kpi",
  "data": { "value": 45230, "delta": 12.5 },
  "source": { "kind": "inline", "data": {} }
}
```

**Ahora (v0.2, real):**
```json
{
  "type": "kpi",
  "config": { "title": "Revenue", "format": "currency" },
  "source": {
    "kind": "query",
    "dataSourceId": "ds_stripe_prod",
    "query": { "kind": "stripe", "operation": { "type": "getRevenue", "params": { "period": "month", "count": 6 } } }
  }
}
```

**Diferencia:** el widget NO trae `data`. Trae `source.query` que se ejecuta server-side. El data se hidrata en el render.

**Ver `widget-system.md` §3.1 actualizado** para el nuevo shape completo.

---

## 4. API endpoint

```typescript
// app/api/dashboards/generate/route.ts

export async function POST(req: Request) {
  const { orgId, userId, role } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.create');
  await checkQuota(orgId, 'generationsPerHour');
  
  const { prompt, dashboardId, dataSourceId } = await req.json();
  
  // 1. Get LLM provider from org settings
  const llm = await getLLMForOrg(orgId);
  
  // 2. Build system prompt with schema context (podada si contiene >20 tablas para optimizar tokens)
  const dataSource = await getDataSource(orgId, dataSourceId);
  const rawSchema = dataSource.schemaCache || (await dataSource.connector.getSchema());
  const prunedSchema = pruneSchemaForPrompt(rawSchema, prompt);
  const systemPrompt = buildSystemPrompt({
    dataSource,
    schemaContext: JSON.stringify(prunedSchema, null, 2),
    dashboardContext: dashboardId ? await getDashboardContext(dashboardId) : null,
  });
  
  // 3. Generate dashboard JSON with retry
  const result = await generateDashboardWithRetry({
    llm,
    systemPrompt,
    userPrompt: prompt,
    maxRetries: 3,
  });
  
  // 4. Ejecutar queries via query-engine (ver specs/query-engine.md §9)
  const hydratedWidgets = await hydrateDashboard(orgId, result.dashboard.widgets);
  
  // 5. Save dashboard
  const saved = await saveDashboard({
    orgId,
    userId,
    dashboardId,
    prompt,
    dashboard: { ...result.dashboard, widgets: hydratedWidgets },
    metadata: result.metadata,
  });
  
  // 6. Track usage
  await trackLLMUsage(orgId, userId, llm.modelId, result.metadata);
  await audit(orgId, userId, 'dashboard.generated', `dashboard:${saved.id}`, { promptLength: prompt.length });
  
  return Response.json({ dashboard: saved });
}
```

---

## 5. Query execution (server-side, real data)

> **Nota v0.3:** La ejecución de queries está documentada como spec dedicado en `specs/query-engine.md`. Esta sección queda solo como referencia de la integración con el route handler de arriba.

```typescript
// lib/query-engine/hydrate.ts (ver specs/query-engine.md §7 + §9)

import { hydrateDashboard } from '@/lib/query-engine';

const hydratedWidgets = await hydrateDashboard(orgId, result.dashboard.widgets);
// Cada widget se hidrata en paralelo; widgets fallidos muestran error state
// sin propagar el error a los demás widgets.
```

**Validación previa al execute (crítico para seguridad):**
```typescript
// lib/dashboards/validate-query.ts

export function validateQuery(query: Query, dataSourceType: ConnectorType): void {
  if (dataSourceType === 'postgres') {
    if (query.kind !== 'sql') {
      throw new ValidationError('Postgres expects SQL query');
    }
    const sql = query.sql.trim().toUpperCase();
    
    // Solo lectura
    if (!/^(SELECT|WITH|EXPLAIN)/.test(sql)) {
      throw new ValidationError('Only SELECT queries allowed');
    }
    
    // Prohibir statements peligrosos
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/;
    if (forbidden.test(sql)) {
      throw new ValidationError('DML/DDL not allowed');
    }
    
    // Auto-inject LIMIT si no tiene
    if (!/LIMIT\s+\d+/i.test(query.sql)) {
      query.sql = `${query.sql} LIMIT 10000`;
    }
  }
  
  if (dataSourceType === 'stripe') {
    if (query.kind !== 'stripe') {
      throw new ValidationError('Stripe expects stripe operation');
    }
  }
  
  if (dataSourceType === 'sheets') {
    if (query.kind !== 'sheets') {
      throw new ValidationError('Sheets expects sheet query');
    }
  }
}
```

---

## 6. System prompt engineering

### 6.1 Estructura del prompt

```
1. ROLE — quién es la IA
2. CAPABILITIES — qué widgets puede generar
3. ARCHETYPES — vocabulario de patrones + reglas de variedad (v0.4)
4. RULES — restricciones duras
5. SCHEMA — JSON schema del Dashboard incluyendo archetype + variant
6. DATA SOURCE — schema del data source conectado
7. EXAMPLES — 2-3 few-shot con archetypes distintos
8. OUTPUT_FORMAT — recordatorio de JSON estricto
```

### 6.2 Template

```typescript
// lib/ai/prompts.ts

export function buildSystemPrompt({ dataSource, schemaContext, dashboardContext, recentArchetypes = [] }) {
  return `
# ROLE
Eres dash-bi AI. Compones dashboards BI a partir de prompts en lenguaje natural.
Los widgets que generes se renderizarán con DATOS REALES del data source conectado.

# CAPABILITIES
Puedes usar estos 7 tipos de widget: ${WIDGET_TYPES.join(', ')}
Cada widget referencia un QUERY que se ejecuta contra el data source. NO generas data hardcodeada.

${ARCHETYPE_SYSTEM_PROMPT_RULES}                                          // v0.4: inyectado desde specs/dashboard-archetypes.md §7

# RULES (estrictas)
1. Solo estos 7 tipos: ${WIDGET_TYPES.join(', ')}
2. SIEMPRE devuelve JSON válido
3. Cada widget referencia una query real via source.kind: 'query'
4. Para Postgres: usa SQL con SELECT, agrega LIMIT si es necesario
5. Para Stripe: usa operaciones específicas (listCharges, getRevenue, etc.)
6. Para Sheets: especifica spreadsheetId + range
7. Máximo 12 widgets por dashboard (los archetypes definen límites más estrictos)
8. SIEMPRE setea "archetype" en el output (incluso "custom" si compones libremente)
9. SIEMPRE setea "archetypeVariant" con density, accent, timeWindow, comparativo

# RECENT ARCHETYPES USED (v0.4: para forzar variedad)
${recentArchetypes.length ? recentArchetypes.join(', ') : '(ninguno todavía)'}

# WIDGET SCHEMA
\`\`\`typescript
${generateWidgetSchemaDocs()}
\`\`\`

# DASHBOARD SCHEMA (v0.4 incluye archetype)
\`\`\`typescript
{
  title: string;
  theme: 'moderno-saas' | 'corporate';
  archetype: ArchetypeId;                       // v0.4
  archetypeVariant: {                           // v0.4
    density: 'spacious' | 'balanced' | 'dense';
    accent: 'default' | 'accent' | 'muted';
    timeWindow: 'last_24h' | 'last_7d' | 'last_30d' | ...;
    comparativo: 'none' | 'previous_period' | ...;
  };
  widgets: Widget[];
}
\`\`\`

# DATA SOURCE: ${dataSource.name} (${dataSource.type})
${schemaContext}

# DASHBOARD ACTUAL ${dashboardContext ? '(edit mode)' : '(new)'}
${dashboardContext ? JSON.stringify(dashboardContext, null, 2) : 'N/A'}

# EXAMPLES (3 ahora, cada uno con archetype distinto — ver §6.3)

# OUTPUT FORMAT
Responde SOLO con el JSON. Sin markdown, sin explicaciones, sin \`\`\`json.
Comienza directamente con {
  `.trim();
}
```

> **v0.4:** El template ahora incluye el bloque `ARCHETYPES` (importado de `specs/dashboard-archetypes.md` §7) y el bloque `RECENT ARCHETYPES USED` (estado por usuario para forzar variedad). Ver `specs/dashboard-archetypes.md` §6 para las reglas completas.

### 6.3 Few-shot examples (ACTUALIZADOS — ahora con queries reales + archetypes)

> **v0.4:** Cada ejemplo incluye el `archetype` que eligió la IA y por qué, demostrando que el sistema elige distintas estructuras para prompts similares.

```typescript
const EXAMPLE_STRIPE: Dashboard = {
  title: "Revenue últimos 6 meses",
  theme: "moderno-saas",
  archetype: "kpi-grid",                     // v0.4: prompt general → kpi-grid
  archetypeVariant: {
    density: "balanced",
    accent: "default",
    timeWindow: "last_6mo",
    comparativo: "previous_period",
  },
  widgets: [
    {
      type: "kpi",
      id: "w1",
      position: { col: 1, row: 1, colSpan: 4, rowSpan: 1 },
      config: { title: "Revenue total", format: "currency", showDelta: true },
      source: {
        kind: "query",
        dataSourceId: "ds_stripe_prod",
        query: {
          kind: "stripe",
          operation: {
            type: "getRevenue",
            params: { period: "month", count: 6 }
          }
        }
      }
    },
    {
      type: "kpi",
      id: "w2",
      position: { col: 5, row: 1, colSpan: 4, rowSpan: 1 },
      config: { title: "Nuevos clientes", format: "number" },
      source: {
        kind: "query",
        dataSourceId: "ds_stripe_prod",
        query: {
          kind: "stripe",
          operation: { type: "listCustomers", params: { limit: 100 } }
        }
      }
    },
    {
      type: "line-chart",
      id: "w3",
      position: { col: 1, row: 2, colSpan: 12, rowSpan: 3 },
      config: { title: "Revenue mensual", smooth: true },
      source: {
        kind: "query",
        dataSourceId: "ds_stripe_prod",
        query: {
          kind: "stripe",
          operation: {
            type: "getRevenue",
            params: { period: "month", count: 6 }
          }
        }
      }
    }
  ],
};
```

```typescript
const EXAMPLE_POSTGRES: Dashboard = {
  title: "User Activity",
  theme: "corporate",
  archetype: "executive-summary",              // v0.4: prompt sobre usuarios activos → executive-summary
  archetypeVariant: {
    density: "spacious",
    accent: "accent",
    timeWindow: "last_30d",
    comparativo: "previous_month",
  },
  widgets: [
    {
      type: "kpi",
      id: "w1",
      position: { col: 1, row: 1, colSpan: 6, rowSpan: 2 },     // hero-metric (6 col, alto)
      config: { title: "DAU", format: "number", showDelta: true, deltaType: "percent", comparisonPeriod: "previous" },
      source: {
        kind: "query",
        dataSourceId: "ds_pg_main",
        query: {
          kind: "sql",
          sql: `
            SELECT COUNT(DISTINCT user_id) AS value
            FROM events
            WHERE created_at >= NOW() - INTERVAL '30 days'
              AND event_type = 'session_start'
          `
        }
      }
    },
    {
      type: "area-chart",
      id: "w2",
      position: { col: 1, row: 3, colSpan: 12, rowSpan: 4 },   // chart-spotlight
      config: { title: "DAU últimos 30 días", gradient: true, smooth: true },
      source: {
        kind: "query",
        dataSourceId: "ds_pg_main",
        query: {
          kind: "sql",
          sql: `
            SELECT DATE(created_at) AS x, COUNT(DISTINCT user_id) AS y
            FROM events
            WHERE created_at >= NOW() - INTERVAL '30 days'
              AND event_type = 'session_start'
            GROUP BY DATE(created_at)
            ORDER BY x
            LIMIT 100
          `
        }
      }
    }
  ],
};
```

```typescript
const EXAMPLE_FINANCE: Dashboard = {
  title: "P&L Q3",
  theme: "corporate",
  archetype: "finance-report",               // v0.4: prompt "P&L" → finance-report (no kpi-grid)
  archetypeVariant: {
    density: "dense",
    accent: "muted",
    timeWindow: "last_quarter",
    comparativo: "previous_quarter",
  },
  widgets: [
    {
      type: "kpi",
      id: "w1",
      position: { col: 1, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: "Revenue", format: "currency", showDelta: true },
      source: { /* SQL o Stripe query */ }
    },
    {
      type: "kpi",
      id: "w2",
      position: { col: 4, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: "COGS", format: "currency", showDelta: true },
      source: { /* … */ }
    },
    {
      type: "kpi",
      id: "w3",
      position: { col: 7, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: "Gross margin", format: "percent", showDelta: true },
      source: { /* … */ }
    },
    {
      type: "kpi",
      id: "w4",
      position: { col: 10, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: "Net income", format: "currency", showDelta: true },
      source: { /* … */ }
    },
    {
      type: "pie-chart",
      id: "w5",
      position: { col: 1, row: 2, colSpan: 6, rowSpan: 4 },     // breakdown-list
      config: { title: "Cost breakdown", variant: "donut", showPercent: true },
      source: { /* … */ }
    },
    {
      type: "table",
      id: "w6",
      position: { col: 7, row: 2, colSpan: 6, rowSpan: 4 },     // data-table
      config: {
        title: "Detalle de líneas",
        columns: [/* … */],
        pagination: true,
        pageSize: 20,
        searchable: true,
      },
      source: { /* … */ }
    }
  ],
};
```


---

## 7. Retry logic con feedback

```typescript
// lib/ai/retry.ts

async function generateDashboardWithRetry({ llm, systemPrompt, userPrompt, maxRetries }) {
  let lastError: Error | null = null;
  let promptWithFeedback = userPrompt;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { object, usage } = await generateObject({
        model: llm,
        schema: DashboardSchema,
        system: systemPrompt,
        prompt: promptWithFeedback,
        temperature: 0.2,  // más determinístico
      });
      
      return {
        dashboard: object,
        metadata: {
          generatedBy: llm.modelId,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          attempts,
        },
      };
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} failed:`, error.message);
      
      // Retry con feedback del error
      promptWithFeedback = `${userPrompt}\n\nFix this validation error: ${error.message}`;
    }
  }
  
  // Después de 3 retries, throw error claro al usuario
  throw new DashboardGenerationError(
    `No pude generar el dashboard después de ${maxRetries} intentos. Por favor reformula tu pedido o contacta soporte.`,
    { lastError: lastError?.message }
  );
}
```

**Cambio vs v0.1:** Ya NO hay fallback template. Si falla 3 veces, error claro al usuario con opción de reformular.

---

## 8. Multi-LLM (3 providers)

Ver `multi-llm-router.md` v0.3 — solo OpenAI, Anthropic, Gemini (sin Ollama ni minimax en MVP).

**Implicaciones para este spec:**
- System prompt optimizado para JSON mode (los 3 lo soportan bien)
- Defaults realistas: `gpt-4o`, `claude-3-5-sonnet-latest`, `gemini-1.5-pro`
- Sin Ollama (retrasaría 2 semanas y requiere GPU)
- Sin minimax ni providers community (riesgo de abandonware)

---

## 9. Acceptance criteria

El feature AI-generate-dashboards está completo cuando:

- [ ] La IA devuelve JSON con widgets que referencian queries, NO data hardcodeada
- [ ] Cada query se ejecuta server-side via `connector.executeQuery()`
- [ ] Postgres queries pasan por `validateQuery()` antes de ejecutar (read-only)
- [ ] El dashboard se renderiza con datos REALES en <8 segundos
- [ ] Después de 3 retries fallidos, error claro al usuario (no fallback template)
- [ ] System prompt optimizado (~1,500 tokens, no 3,000)
- [ ] El chat puede pedir cambios y el dashboard se actualiza in-place
- [ ] Cada versión del dashboard se guarda (historial para rollback)
- [ ] El sistema respeta el LLM provider configurado en la org (3 options)
- [ ] El output incluye metadata (modelo, tokens, attempts)
- [ ] Hay rate limiting por org (20/200/ilimitado por plan)
- [ ] Hay logging de todos los prompts y outputs (auditoría)

---

## 10. Out of scope (MVP)

- ❌ `source.kind: 'computed'` (fórmulas)
- ❌ Fallback template estático (ahora es error claro)
- ❌ Drag-and-drop manual de widgets (solo IA genera)
- ❌ Custom widget types por el usuario
- ❌ Widgets con código Python ejecutado
- ❌ Drill-down entre dashboards
- ❌ Vision input al prompt (subir imagen)
- ❌ Scheduled dashboards / auto-refresh

---

## 11. Roadmap (Fase 2+)

**Fase 2 (semana 5-6):**
- Caching de query results ya implementado en MVP (`specs/query-engine.md` §5); Fase 2 lo extiende con semantic caching
- AI explica cada widget ("Por qué Revenue bajó 12% en julio?")
- Heatmap, funnel y scatter opcionales (no estaban en MVP)

**Fase 3 (semana 7-8):**
- Drag-and-drop después de generado
- Custom widget types via UI
- Templates pre-hechos por industria

---

## 12. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| IA genera SQL destructivo | validateQuery() bloquea DML/DDL + DB user con permisos SELECT only |
| Query tarda mucho | statement_timeout 30s en connector + Promise.race con cancel |
| LLM devuelve JSON inválido | Zod validation + retry con feedback |
| Costo de tokens se dispara | System prompt optimizado (~1,500 tokens), rate limit por org |
| IA genera queries que exponen data sensible | RLS en Postgres + permisos de DB user + validación de tablas permitidas |
| Data source caído | Error claro al usuario, retry desde UI |

---

## 13. Performance budget

| Step | Budget |
|------|--------|
| LLM round-trip | 3-5s |
| Query execution (paralelo) | 1-3s |
| Render + serialization | <500ms |
| **Total** | **<8s p50** |

---

## 14. Specs relacionados

- `query-engine.md` — pipeline de ejecución/validación/cache/hidratación (spec dedicado v0.3)
- `widget-system.md` — schema de widgets (v0.3: 7 tipos, `source.kind: 'query'` único válido)
- `multi-llm-router.md` — v0.3 con 3 providers, defaults realistas
- `connectors.md` — `executeQuery()` se ejecuta desde query-engine, no directamente
- `multi-tenant.md` — RLS + quotas
- `export.md` — Puppeteer en worker separado (v0.3)