# Spec: Natural-Language Q&A (NLQA)

> El usuario hace una pregunta en lenguaje natural ("¿Cuánto revenue hubo en julio?") y la IA devuelve: respuesta en texto + chart automático. **Frente actual de AI BI** (ChatGPT BI, ThoughtSpot Search, Hex). Diferenciador estratégico vs Tableau/Metabase/Preset.

**Status:** Draft v0.1 (Tier 1 — recomendación competitiva)
**Prioridad:** P0 — diferenciador estratégico + reusa infra existente
**Responsable:** codehak
**Depende de:** `ai-generate-dashboards.md`, `query-engine.md`, `widget-system.md`, `multi-llm-router.md`

---

## 1. Objetivo

Permitir que un usuario:

1. **Haga preguntas en lenguaje natural** sobre los datos conectados.
2. **Reciba respuestas en <5 segundos** con formato texto + visual.
3. **No necesite saber SQL** — la IA genera y valida la query.
4. **Pueda guardar la respuesta como widget** en un dashboard existente o nuevo.
5. **Pueda iterar** ("¿Y si lo comparamos con el Q1?").

**Casos de uso:**
- "¿Cuánto facturé en julio?" → "$45,230, +12% vs junio"
- "Top 5 productos del Q3" → tabla
- "Tendencia de nuevos usuarios últimos 6 meses" → line chart
- "¿Cuál es el churn rate?" → KPI

---

## 2. Diferencia con AI-generate-dashboards

| Aspecto | `ai-generate-dashboards` | `nlqa` |
|---------|--------------------------|--------|
| Output | Dashboard completo (múltiples widgets) | 1 respuesta (texto + 1 chart) |
| Latency target | <8s | <5s |
| System prompt | Composición de widgets + archetypes | Comprensión de pregunta → SQL |
| Modelo de UI | Chat panel dedicado al lado del dashboard | Chat universal (top bar) |
| Persistencia | Dashboard guardado en DB | Historial de chat; respuestas marcables como "guardar en dashboard" |
| Budget | Hasta 12 widgets | 1 widget como mucho |
| Costo LLM | Mayor (~1,500 tokens output por dashboard) | Menor (~200-500 tokens por respuesta) |

**Decisión arquitectónica:** endpoint y pipeline separado de `/dashboards/generate`. La complejidad es diferente.

---

## 3. UX flow

### 3.1 Universal chat (top bar)

```
┌───────────────────────────────────────────────────────────────┐
│  dash-bi                                    [🔍 Search] [👤] │
├───────────────────────────────────────────────────────────────┤
│  ❓ Preguntale a tus datos...                       [Ask →]   │
└───────────────────────────────────────────────────────────────┘
```

Click en el input → overlay chat a pantalla completa (estilo Spotlight / Cmd+K).

```
┌───────────────────────────────────────────────────────────────┐
│  ❓ ¿Cuánto revenue hubo en julio?              [×]            │
│                                                               │
│  [Historial reciente]                                         │
│   • Top 5 clientes de Q3                                      │
│   • DAU últimos 30 días                                       │
│   • Churn por cohorte                                         │
│                                                               │
│  Sugeridos para [Stripe producción]:                          │
│  • [Cuál es el MRR actual]                                    │
│  • [Revenue por país]                                         │
│  • [Tasa de churn último trimestre]                           │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 Pregunta → respuesta

```
[User]  ¿Cuánto revenue hubo en julio?
         ↓
[Bubble] Pensando...                          (~2-3s, visible)
         ↓
[Bubble] En julio de 2026, **$45,230 USD** (+12% vs junio).
         ↓
[Chart]  ╭─────────────────────────╮
         │   Bar: Julio vs Junio    │     [Guardar widget →]
         ╰─────────────────────────╯
         ↓
[Botones] [↻ Otra vez] [✏ Reformular] [📊 Ver query] [💾 Guardar]
```

### 3.3 Stream + estados intermedios

Para UX responsiva, streaming de eventos desde el server:

```typescript
type NLQAEvent =
  | { kind: 'thinking' }
  | { kind: 'sql_generated'; sql: string }
  | { kind: 'sql_executed'; rowCount: number; msElapsed: number }
  | { kind: 'answer_text'; text: string }
  | { kind: 'chart_suggested'; chartType: ChartType; config: ChartConfig }
  | { kind: 'error'; message: string };
```

UI muestra cada estado (typing indicator → SQL preview → respuesta) con tiempos <500ms entre eventos.

---

## 4. Pipeline end-to-end

```
User pregunta
    ↓
[1] POST /api/nlqa { orgId, dataSourceId, question, conversationId? }
    ↓
[2] Load schema del data source (cached 24h en dataSource.schemaCache)
    ↓
[3] Load conversation history (últimos N turns, N=10)
    ↓
[4] LLM step 1: clasifica intent + genera SQL
    ↓
[5] validateQuery(sql) — mismos validators que ai-generate-dashboards
    ↓ (inválido → retry con feedback, max 2)
    ↓
[6] executeQuery via query-engine (cache + timeout + RBAC)
    ↓
[7] LLM step 2: genera respuesta natural language + sugiere chart type
    ↓
[8] Streaming response (SSE) → cliente
    ↓
[9] Opcional: user click "Guardar widget" → crea widget en dashboard destino
```

### 4.1 Diferencia con ai-generate-dashboards

`ai-generate-dashboards` hace 1 sola llamada al LLM que devuelve JSON con estructura completa.
`nlqa` hace **2 llamadas LLM** orquestadas:
1. **SQL agent:** pregunta → SQL.
2. **Answer agent:** pregunta + SQL + result → texto + chart spec.

Es más confiable y permite streaming intermedio (mostrar la SQL al usuario cuando la IA piensa).

---

## 5. System prompts

### 5.1 SQL agent (paso 1)

```typescript
export function buildNLQASqlPrompt({
  schema, question, history, samples, recentErrors = [],
}: NLQAPromptOptions) {
  return `
# ROLE
Sos un agente SQL. Tu única tarea: convertir preguntas en lenguaje natural a SQL válido.

# DATA SOURCE
${schema.tables.map(t => `${t.name} (${t.columns.length} cols): ...`).join('\n')}

# RULES (estrictas)
1. SIEMPRE devuelve JSON con este shape:
   { "reasoning": "...", "sql": "SELECT ...", "params": [] }
2. Solo SELECT/WITH/EXPLAIN. NUNCA INSERT/UPDATE/DELETE/DROP/ALTER.
3. SIEMPRE poner LIMIT 10000 si no hay LIMIT.
4. Prefijá tablas con su schema si aplica (ej: 'public.orders').
5. Si la pregunta es ambigua, hacé la interpretación MÁS COMÚN y mencionala en reasoning.
6. Si no podés contestar con SQL (pregunta conceptual, sin datos), devolvé:
   { "reasoning": "...", "sql": null, "fallbackAnswer": "..." }

# CONVERSATION HISTORY
${history.map(h => `Q: ${h.question}\nA (SQL): ${h.sql || h.fallbackAnswer}`).join('\n\n')}

# QUESTION
${question}

${recentErrors.length ? `# PREVIOUS ERRORS (evitá repetir)\n${recentErrors.join('\n')}` : ''}

# OUTPUT (solo JSON válido)
  `;
}
```

**Por qué este prompt es diferente del de dashboards:**
- NO compone widgets (solo SQL).
- Reasoning explícito (para debug + mostrar al usuario).
- Manejo explícito de "no se puede contestar con SQL".

### 5.2 Answer agent (paso 2)

```typescript
export function buildNLQAAnswerPrompt({
  question, sql, result, history,
}: NLQAAnswerOptions) {
  return `
# ROLE
Sos un agente de respuesta. Convertís resultados SQL en respuestas cortas + sugerencia de chart.

# QUESTION ORIGINAL
${question}

# SQL EJECUTADO
${sql}

# RESULTADOS (max 50 filas mostradas)
${JSON.stringify(result.rows.slice(0, 50), null, 2)}

# TAREA
Devolvé JSON con:
{
  "answer": "Respuesta corta en español, máximo 2 frases, con números concretos.",
  "chartSuggestion": {
    "type": "kpi" | "line-chart" | "bar-chart" | "pie-chart" | "table" | null,
    "rationale": "Por qué este chart (1 frase)",
    "config": { ... }   // config específico del chart type
  }
}

# REGLAS
- "answer" SIEMPRE en español, conciso (<200 chars), con números reales del result.
- "chartSuggestion" SOLO si el result tiene sentido visual (>= 1 row con dato numérico).
- Si solo hay 1 valor (KPIs), sugerir type "kpi".
- Si hay time series, sugerir "line-chart".
- Si hay categorías, sugerir "bar-chart".
- Si hay distribución partes/total, sugerir "pie-chart".
- Si hay >10 filas, sugerir "table".
  `;
}
```

---

## 6. API endpoint

### 6.1 Endpoint principal (streaming)

```typescript
// app/api/nlqa/route.ts

import { streamText } from 'ai';

export async function POST(req: Request) {
  const { orgId, dataSourceId, question, conversationId } = await req.json();
  const { userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'query.execute');
  
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: NLQAEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      
      try {
        send({ kind: 'thinking' });
        
        // 1. Cargar schema + history
        const schema = await getDataSourceSchema(orgId, dataSourceId);
        const history = conversationId 
          ? await getConversationHistory(conversationId, 10)
          : [];
        
        // 2. SQL agent
        const sqlResult = await generateSQL({
          llm: await getLLMForOrg(orgId),
          prompt: buildNLQASqlPrompt({ schema, question, history }),
        });
        
        if (!sqlResult.sql) {
          send({ kind: 'answer_text', text: sqlResult.fallbackAnswer || 'No puedo responder con datos.' });
          controller.close();
          return;
        }
        
        send({ kind: 'sql_generated', sql: sqlResult.sql });
        
        // 3. Validate SQL
        const connector = await resolveConnector(orgId, dataSourceId);
        validateQuery({ kind: 'sql', sql: sqlResult.sql }, connector.type);
        
        // 4. Execute
        const result = await executeWithTimeout(connector, 
          { kind: 'sql', sql: sqlResult.sql }, 
          { timeoutMs: 30000, retries: 1 }
        );
        
        send({ 
          kind: 'sql_executed', 
          rowCount: result.rowCount,
          msElapsed: result.executionTimeMs,
        });
        
        // 5. Answer agent
        const answer = await generateAnswer({
          llm: await getLLMForOrg(orgId),
          prompt: buildNLQAAnswerPrompt({ question, sql: sqlResult.sql, result }),
        });
        
        send({ kind: 'answer_text', text: answer.answer });
        
        if (answer.chartSuggestion) {
          send({ 
            kind: 'chart_suggested', 
            chartType: answer.chartSuggestion.type,
            config: answer.chartSuggestion.config,
          });
        }
        
        // 6. Persistir en historial
        await saveConversationTurn({
          conversationId, orgId, userId, 
          question, sql: sqlResult.sql,
          answer: answer.answer,
          chartSuggestion: answer.chartSuggestion,
        });
        
      } catch (error) {
        send({ kind: 'error', message: userMessage(error) });
        log.error({ error, orgId, question });
      } finally {
        controller.close();
      }
    },
  });
  
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}
```

### 6.2 Endpoint: guardar como widget

```typescript
// app/api/nlqa/save-as-widget/route.ts
export async function POST(req: Request) {
  const { orgId, dashboardId, position, chartSuggestion, sql } = await req.json();
  const { userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.edit');
  
  // Crear widget a partir del chartSuggestion
  const widget = {
    id: generateId(),
    type: chartSuggestion.type,
    position: position ?? findFirstEmptySlot(dashboardId),
    config: chartSuggestion.config,
    source: {
      kind: 'query',
      dataSourceId: chartSuggestion.dataSourceId,
      query: { kind: 'sql', sql },
    },
    data: null,    // se hidrata en el primer render
  };
  
  await addWidget(dashboardId, widget);
  return Response.json({ widgetId: widget.id });
}
```

---

## 7. Modelo de datos: historial de conversaciones

```typescript
// db/schema.ts
export const nlqaConversations = pgTable('nlqa_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  dataSourceId: uuid('data_source_id').references(() => dataSources.id),
  
  title: text('title'),                       // auto-generado del primer Q
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const nlqaTurns = pgTable('nlqa_turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => nlqaConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),               // 'user' | 'assistant'
  content: text('content').notNull(),
  metadata: jsonb('metadata'),                // {sql, rowCount, chartSuggestion, etc.}
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

### 7.1 RLS policies (P0 — privacidad cross-user)

Las conversaciones son privadas del usuario que las creó, pero el admin de la org puede ver todas las conversaciones de su org (para auditoría):

```sql
ALTER TABLE nlqa_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlqa_turns ENABLE ROW LEVEL SECURITY;

-- Policy principal: el user que creó la conversación la ve
CREATE POLICY nlqa_owner_sees_conversation ON nlqa_conversations
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- Policy adicional: admin de la org ve todas las conversaciones de su org
CREATE POLICY nlqa_org_admin_sees_all ON nlqa_conversations
  USING (
    org_id = current_setting('app.current_org_id')::uuid
    AND current_setting('app.current_user_role') = 'admin'
  );

-- Turns: solo si el user tiene acceso a la conversación parent
CREATE POLICY nlqa_turns_accessible ON nlqa_turns
  USING (
    conversation_id IN (
      SELECT id FROM nlqa_conversations
      WHERE user_id = current_setting('app.current_user_id')::uuid
         OR (
           org_id = current_setting('app.current_org_id')::uuid
           AND current_setting('app.current_user_role') = 'admin'
         )
    )
  );
```

**Tests de aislamiento (P0, ver `testing.md` §3.2):**

```typescript
describe('NLQA tenant + role isolation', () => {
  it('Org A user cannot read Org B user conversations', ...);
  it('Org A editor cannot read Org A admin conversations', ...);
  it('Org A admin CAN read all conversations in their org', ...);
  it('Org A viewer can only read their own conversations', ...);
});
```

**Privacidad:** las conversaciones son visibles **solo para el usuario que las creó** (no org-wide), con la excepción de admin de la org (para auditoría). Default 90 días retención, después auto-delete via cron job.

---

## 8. Configuración por org

```typescript
// db/schema.ts (extensión a orgs)
export const orgs = pgTable('orgs', {
  // ...existing
  nlqaEnabled: boolean('nlqa_enabled').notNull().default(true),
  nlqaMonthlyLimit: integer('nlqa_monthly_limit').notNull().default(200),   // por seat
});
```

`nlqaEnabled: false` deshabilita el feature completo (para planes enterprise que prohíben queries libres).

---

## 9. Seguridad

### 9.1 Validación SQL (reusa ai-generate-dashboards)

```typescript
validateQuery({ kind: 'sql', sql: generatedSql }, connector.type);
// Reusa lib/security/validate-query.ts (5 layers: regex DML, allowlist table, DB user SELECT-only, 
// statement_timeout, LIMIT auto-inject)
```

Si falla → retry con feedback (max 2), después error claro al usuario.

### 9.2 Table allowlist dinámico

El system prompt SOLO inyecta las tablas del data source activo. La IA no puede "inventar" tablas de otros data sources o schemas.

### 9.3 Rate limit

```typescript
const NLQA_LIMITS = {
  free:        { queriesPerHour: 30,  monthlyQueries: 500 },
  pro:         { queriesPerHour: 200, monthlyQueries: 5000 },
  enterprise:  { queriesPerHour: -1,  monthlyQueries: -1 },
};
```

### 9.4 PII redaction en respuestas (Fase 2)

Si la query devuelve PII (emails, teléfonos), la respuesta se redacta automáticamente en el resumen. La SQL completa sigue ejecutándose, pero el texto al usuario solo dice "12 resultados".

---

## 10. Acceptance criteria

- [ ] User hace pregunta en chat universal
- [ ] Streaming de eventos visible (thinking → SQL → result → answer → chart)
- [ ] Total latency p50 <5s, p95 <10s
- [ ] SQL generada pasa por validateQuery (5 layers de defensa)
- [ ] Si la query falla → retry con feedback del error (max 2)
- [ ] Si falla 2 veces → error claro al usuario
- [ ] Respuesta es en español, concisa, con números concretos del result
- [ ] Chart sugerido coherente con el data shape (KPI / line / bar / pie / table)
- [ ] User puede "Guardar como widget" en un dashboard existente
- [ ] Historial de conversaciones persiste 90 días
- [ ] Conversaciones son privadas (solo visibles para el user que las creó)
- [ ] Admin puede deshabilitar NLQA para toda la org
- [ ] Rate limit por org enforced
- [ ] Cross-tenant queries bloqueadas (test de seguridad)
- [ ] Funciona con los 3 data sources MVP (Postgres, Stripe, Sheets)
- [ ] Funciona con csv/excel-connector cuando esté

---

## 11. Out of scope (MVP)

- ❌ Memoria cross-session ("recordá que mi región = LatAm")
- ❌ Multi-turn complex reasoning ("filtrá por cohortes que tengan >$1000 LTV...")
- ❌ Sugerencias proactivas ("hey, te puede interesar: tu revenue subió 30%")
- ❌ Voz input (Fase 3)
- ❌ Slack/Discord bot que use este endpoint (Fase 2)
- ❌ Embeddings + RAG sobre docs de la org (Fase 3)
- ❌ PII auto-redaction (Fase 2)
- ❌ Charts custom más allá de los 7 widgets
- ❌ Drill-down (click en el chart abre dashboard)
- ❌ Export del chart aislado (solo guardar en dashboard)

---

## 12. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| IA genera SQL peligrosa | 5 layers validate, retry con feedback, RBAC + RLS |
| IA inventa números (hallucination) | Obligatorio pasar por `executeQuery` real — nunca devolver numbers inventados |
| Costo de tokens se dispara (2 calls LLM por pregunta) | Cache de pregunta normalizada + semantic cache (Fase 2); budget por org/mes |
| Latency alta con queries lentas | `statement_timeout: 30s` + Promise.race; UI muestra progress |
| Chart sugerido es inadecuado | Permitir al user cambiar el chart type post-respuesta (botones) |
| Conversaciones leak PII entre users | RLS estricto + solo user que creó las ve |
| Feature se abusa (consultas masivas) | Rate limits granulares + quota mensual |
| Modelos LLM cambian capabilities | Pin versiones de modelos (idem multi-llm-router) |

---

## 13. Performance budget

| Step | Budget p50 |
|------|------------|
| Load schema (cached) | <50ms |
| SQL agent (LLM) | 1.5-3s |
| Validate SQL | <10ms |
| Execute query (cache hit) | <100ms |
| Execute query (no cache) | 1-5s |
| Answer agent (LLM) | 1-2s |
| Render chart | <200ms |
| **Total** | **<5s p50, <10s p95** |

---

## 14. Roadmap post-MVP

**Fase 2:**
- Semantic caching (preguntas similares → misma respuesta)
- Suggestions proactivas cada lunes ("tu weekly report")
- Slack/Discord bot con este endpoint
- Memory cross-session ("recordá esta preferencia")

**Fase 3:**
- Voz input (Whisper)
- Multi-step reasoning (chain-of-thought + tool calls)
- Embeddings + RAG sobre docs/notion de la org
- Auto-detección de "este query se repite mucho → sugiérenmelo"

---

## 15. Dependencias

Reusa todo el stack existente:

```json
{
  "dependencies": {
    "ai": "^6.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "@ai-sdk/google": "^2.0.0",
    "bullmq": "^5.34.0"
  }
}
```

---

## 16. Specs relacionados

- `ai-generate-dashboards.md` — reusa `validateQuery`, multi-LLM router, retry pattern
- `query-engine.md` — `executeWithTimeout`, cache, RLS
- `widget-system.md` — el chart sugerido respeta los 7 tipos + schema
- `multi-llm-router.md` — usa el mismo `getLLMForOrg(orgId)`
- `multi-tenant.md` — `withOrgContext` en todos los endpoints, RLS en `nlqa_*`
- `onboarding.md` — el NLQA es uno de los "wow moments" del día 1
- `demo-mode.md` — NLQA funciona sobre datos de demo (gran combo de onboarding)
- `csv-excel-connector.md` — NLQA funciona sobre archivos subidos
