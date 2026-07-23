# Architecture — dash-bi

> Decisiones arquitectónicas y diagramas técnicos.

> **Cambios v0.5 (sync 2026-07-22 — Tier 1 competitive):** agregados 3 specs estratégicos para cerrar gap competitivo — `specs/demo-mode.md` (datos sintéticos pre-cargados), `specs/csv-excel-connector.md` (4º data source), `specs/nlqa.md` (Q&A en lenguaje natural). Detalles al final del documento.

> **Cambios v0.3 (sync 2026-07-21):** query engine documentado en `specs/query-engine.md`; i18n monolingüe español confirmado (next-intl removido del middleware); defaults LLM corregidos a versiones actuales.

## Stack confirmado

```
┌─────────────────────────────────────────────────────┐
│                   Frontend                          │
│   Next.js 16 + React 19 + TypeScript strict         │
│   Tailwind 4 + shadcn/ui + Tremor (o shadcn charts) │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│              Next.js API + Server Actions           │
│   better-auth (orgs) + Drizzle ORM                  │
│   TanStack Query (server state)                     │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                  PostgreSQL 16                       │
│   Multi-tenant (org_id) + Row Level Security        │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│              Query Engine (lib/query-engine)         │
│   Resolver · Validate · Cache (Redis) · Execute     │
│   · Hydrate (ver specs/query-engine.md)              │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│                AI Layer (Vercel AI SDK v6)            │
│   Multi-provider: OpenAI / Anthropic / Gemini       │
│   (3 providers — sin Ollama ni minimax en MVP)       │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│                Connectors (P0)                      │
│   PostgreSQL · Stripe · Google Sheets               │
│   · CSV/Excel (Tier 1, v0.5) → Postgres staging     │
└─────────────────────────────────────────────────────┘
```

**Workers separados (Postgres principal + Puppeteer PDF):**
- Worker PDF (Puppeteer headless Chrome): recibe `/pdf/render` vía HTTP interno, devuelve el PDF buffer
- Comunicación con la app principal vía queue (BullMQ + Redis) para evitar bloquear el Next.js
- Ver `export.md` §3 para el flujo end-to-end

**Workers adicionales (v0.5, Tier 1 competitive):**
- `seed-demo-{orgId}` — job BullMQ que genera datos sintéticos para `demo-mode.md`. Concurrencia 2, timeout 2 min. Reusa Redis existente.
- `load-file-{fileId}` — job BullMQ que crea tabla Postgres + RLS para archivos CSV/Excel subidos (csv-excel-connector §6.1). Concurrencia 1, timeout 5 min.
- `nlqa` **no requiere worker propio** — el endpoint `/api/nlqa` es streaming SSE directo (latency budget <5s p50, ver `nlqa.md` §13).

## AI-genera-dashboards: flujo de datos

```
Usuario escribe prompt
        ↓
Chat panel (Vercel AI SDK v6 streaming)
        ↓
LLM (provider seleccionado por org, BYOK cifrado)
        ↓
JSON Dashboard { title, theme, widgets[ { source.kind: 'query' } ] }
        ↓
Validator (Zod schema)
        ↓ (inválido → retry con feedback, max 3)
        ↓
Query Engine (lib/query-engine/)
  - resolveConnector(orgId, dataSourceId)
  - validateQuery (regex + table allowlist)
  - executeQuery con timeout (30s) + circuit breaker
  - cache (Redis, TTL 60s)
  - hydrateWidget(rows → data shape)
        ↓
Dashboard renderizado con datos REALES
        ↓
Usuario edita prompt → loop vuelve al inicio
```

Ver `specs/query-engine.md` para el detalle del pipeline de ejecución.

## Multi-LLM Router

```typescript
// pseudocódigo del router
const llmRouter = {
  openai: openai(org.llmModel ?? 'gpt-4o'),
  anthropic: anthropic(org.llmModel ?? 'claude-3-5-sonnet-latest'),
  gemini: google(org.llmModel ?? 'gemini-1.5-pro'),
};

// en cada request
const provider = org.settings.llmProvider;
const model = llmRouter[provider];
const result = await streamText({ model, prompt, schema: dashboardSchema });
```

Defaults conservador: nombres que existen como GA al 2026-07-21. Ver `specs/multi-llm-router.md` §2 para la lista completa y capabilities por provider.

## Multi-tenant data model

```
organizations
  ├── id
  ├── name
  ├── slug
  ├── settings (jsonb: llm_provider, branding, etc.)
  └── created_at

users
  ├── id
  ├── email
  └── global

org_users (many-to-many)
  ├── user_id
  ├── org_id
  └── role (admin|editor|viewer)

data_sources
  ├── id
  ├── org_id
  ├── type (postgres|stripe|sheets|...)
  ├── config (jsonb: credentials cifrados)
  └── created_at

dashboards
  ├── id
  ├── org_id
  ├── title
  ├── theme
  ├── layout (jsonb)
  ├── widgets (jsonb: array de widgets)
  ├── created_by
  └── created_at

queries (audit log)
  ├── id
  ├── org_id
  ├── data_source_id
  ├── query_text
  ├── executed_by
  └── created_at
```

## Deploy architecture

**Único target MVP: Docker Compose** (decidido post-auditoría 2026-07-21).

```
┌────────────────────┐
│   Nginx (reverse)  │
└────────┬───────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌───────┐ ┌──────────┐
│ App   │ │PostgreSQL│
│ Next  │ │    16    │
│+Puppeteer│ │       │
└───────┘ └──────────┘
```

**Por qué no Cloudflare D1:** D1 es SQLite, no soporta Row Level Security, `SET LOCAL`, ni jsonb con índices GIN. Toda la arquitectura multi-tenant requiere Postgres completo.

**Roadmap Fase 3:** soporte para deploy serverless con `@sparticuz/chromium` (Puppeteer-compatible para AWS Lambda) o Vercel Edge con Hyperdrive + Postgres externo.

## Decisiones técnicas clave

| Decisión | Razón | Trade-off |
|----------|-------|-----------|
| PostgreSQL sobre DuckDB | Familiar para empresas, multi-tenant persistente | Menos rápido para analytics puro |
| Drizzle sobre Prisma | Más liviano, mejor para edge, tipos perfectos | Comunidad más chica |
| better-auth sobre NextAuth | Más moderno, mejor DX, OSS activo | Menos maduro (cubre con tests de upgrade) |
| Tremor sobre Recharts solo | Look SaaS out-of-the-box | Menos customizable (evaluar migrar a shadcn charts si bloquea) |
| Vercel AI SDK v6 sobre LangChain | Multi-provider nativo, streaming, liviano | Menos features "AI agent" |
| JSON widgets sobre HTML directo | Control de layout, validación, edit iterativo | Limitado a tipos pre-definidos (7 widgets MVP) |
| **dnd-kit sobre react-grid-layout** | Estándar 2026, accesible, ~2.8M weekly downloads | Más código custom de grid (12-col layout) |
| **TanStack Query sobre zustand para server state** | Caché, revalidación, optimistic updates dedicados | Separación clara UI/server |
| **Puppeteer en worker separado** | Chromium no comparte memoria con la app | Overhead operacional (2 servicios) |
| **Query engine con Redis cache** | Queries se ejecutan muchas veces (refresh / links públicos) | Otra infra (Redis) — considerar pg-boss si no se necesita |

## Política de caching Next.js 16

Next.js 16 cambió defaults de caching (Turbopack estable, Cache Components). Reglas:

| Contexto | Default | Override |
|----------|---------|----------|
| RSC que lee DB con `orgId` | `'no-store'` (no cache) | Forzado, no se puede cachear |
| API routes con auth | `dynamic = 'force-dynamic'` | Forzado |
| Server actions que mutan data | `'no-store'` | Forzado |
| Assets públicos (`/share/[token]`) | `'use cache: private'` con `cacheTag(orgId)` | TTL 30s |
| Catálogo de themes/widget types | `'use cache'` con tag | TTL 1h |

Regla de oro: **toda ruta o action que toque data tenant-scoped debe ser `no-store` o `force-dynamic`**. El linter custom (`withOrgContext` rule) debe rechazar RSC que cachean por accidente.

## v0.5 (sync 2026-07-22) — Tier 1 competitive features

Análisis post-auditoría v1.0 identificó **3 features que la competencia tiene y dash-bi no**. Se crearon 3 specs nuevas, todas compatibles con la arquitectura actual (no requieren cambios estructurales):

### `specs/demo-mode.md` — Demo Mode

- **Qué:** Usuario nuevo elige entre 3 personas (SaaS startup / E-commerce / B2B agency) y ve un dashboard renderizado con datos sintéticos antes de conectar nada.
- **Arquitectura:** Datos sintéticos se cargan en tablas Postgres con prefijo `demo_*` por org (`<orgId_safe>`). El query-engine existente los sirve sin cambios. Job BullMQ `seed-demo-*` en background genera los rows (no bloquea UI).
- **Determinismo:** Seed SHA-256 del `orgId` — mismo org siempre ve misma data. `faker.js` pin v9.
- **RLS:** Aplica normal; las tablas `demo_*` siguen las policies existentes.
- **Costo:** ~50MB por demo activo. Con 1k demos activos = 50GB. Cleanup 30 días.
- **Impacto top-of-funnel:** target signup → primera vista de dashboard >95% (vs ~70% actual).

### `specs/csv-excel-connector.md` — CSV/Excel como data source

- **Qué:** Usuario sube archivos CSV/TSV/XLSX (max 100MB, 1M filas). El archivo se transforma en una tabla SQL accesible via connector.
- **Arquitectura:** Nuevo `connectorType: 'spreadsheet'` (cubre CSV + Excel — la diferencia es solo el parser). Cada archivo subido crea tabla en schema `org_<id>` con RLS dedicado. Worker `load-file-*` usa `COPY FROM STDIN` (10-100x más rápido que INSERT batch).
- **Modelos:**
  - `uploaded_files` — metadata del archivo (FK a org_id, targetTable, columns jsonb, rowCount, format).
  - Tabla SQL generada por upload — vive en schema `org_<id>` con RLS policy por tabla.
- **Seguridad:** Formula injection mitigation (`=+-@` prefix sanitization), CSV size cap, encoding auto-detect.
- **Reuso:** El query engine trata la tabla spreadsheet como una tabla Postgres más. Sin cambios en `query-engine.md`.

### `specs/nlqa.md` — Natural-Language Q&A

- **Qué:** Chat universal: "¿Cuánto revenue hubo en julio?" → respuesta texto + chart automático. Pensado como el "Ask BI Anything" tipo ChatGPT BI / ThoughtSpot Search.
- **Arquitectura:** Endpoint `/api/nlqa` streaming SSE. **2 llamadas LLM orquestadas** (vs 1 en ai-generate-dashboards):
  1. SQL agent: pregunta → JSON con `{reasoning, sql}`.
  2. Answer agent: pregunta + SQL + result → JSON con `{answer, chartSuggestion}`.
- **Reuso:** `validateQuery`, `executeWithTimeout`, multi-LLM router (`getLLMForOrg`), RLS via `withOrgContext`. Sin cambios en `query-engine.md`.
- **Privacidad:** Conversaciones solo visibles para el user que las creó. 90 días retención.
- **Latency budget:** <5s p50, <10s p95.
- **Rate limit:** 30 (free), 200 (pro), ilimitado (enterprise) por seat.

### Por qué este orden

| Feature | Costo implementación | Impacto funnel | Impacto retencion | Decisión |
|---------|---------------------|----------------|--------------------|----------|
| demo-mode | Bajo (1 semana) | Muy alto | Bajo | **Implementar primero** |
| csv-excel-connector | Medio (1.5 semanas) | Alto | Medio | Implementar 2do |
| nlqa | Medio-alto (2 semanas) | Medio | Alto (sticky feature) | Implementar 3ro |

### Decisiones arquitectónicas que no cambian

- ✅ Multi-tenant security (RLS + withOrgContext) — aplica idéntico
- ✅ Threat model T1-T8 — aplica idéntico (especialmente T2 SQL injection: NLQA pasa por validateQuery igual que dashboards)
- ✅ Multi-LLM router (3 providers) — NLQA reusa `getLLMForOrg(orgId)` sin cambios
- ✅ Frontend stack (Next.js 16 + React 19) — sin cambios
- ✅ Deploy (Docker Compose single-node) — sin cambios (los nuevos workers usan el mismo Redis)

### Roadmap post-MVP impactado

- **Fase 2:** embed mode, scheduled reports, semantic metrics layer (definidos como Tier 2 competitivos).
- **Fase 3:** collaborative editing (Yjs), voice input NLQA, multi-lang i18n.

Ver análisis competitivo completo en sesión 2026-07-22 (análisis pre-v0.5).

## Multi-idioma (i18n)

**MVP monolingüe español.** `middleware.ts` antes referenciaba `next-intl` (no instalado); ahora hace auth real.

Razones:
- Target primario (Bastián) es usuario hispanohablante
- Reduce scope y matriz de pruebas
- Migración a i18n completo en Fase 2 con `next-intl` cuando haya tracción

Notas operativas:
- Copy en español, código/tipos de DB en inglés
- Strings centralizadas desde día 1 en `messages/es.json` (preparar para Fase 2)

## Pendientes arquitectónicos (decisiones a tomar en semana 1)

- [x] Cómo cifrar credenciales de data sources en DB — AES-256-GCM con master key de env (ver `lib/security/encryption.ts`)
- [ ] Rate limiting per org para LLM calls — implementar en semana 3
- [x] Cache de queries — Redis con fallback a memoria (ver `specs/query-engine.md` §5)
- [ ] Estrategia de migración de schema — Drizzle migrations + `drizzle-kit check` en CI
- [x] Auth flow — magic links + Google OAuth (ver `specs/auth.md`)
- [ ] Storage de PDFs generados — local FS primero, Fase 2 R2/S3 configurable