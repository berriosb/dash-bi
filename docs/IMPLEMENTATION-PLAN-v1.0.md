# Plan de Implementación v1.0 — dash-bi

> Plan consolidado post-auditorías (arquitectura 2026-07-21 + stack 2026-07-21). Integra TODAS las decisiones P0/P1/P2 de los reportes de auditoría y reemplaza los planes anteriores dispersos en SPEC.md.

**Fecha:** 2026-07-21
**Status:** v1.0 (congelado para implementar)
**Responsable:** codehak

**Fuentes:**
- `docs/audits/2026-07-21-arquitectura/REPORTE.md` (auditoría arquitectura)
- `docs/audits/2026-07-21-arquitectura/STACK-AUDIT.md` (auditoría stack)

---

## Decisiones finales (post-auditoría)

### Stack confirmado (con versiones específicas)

| Capa | Tecnología | Versión | Razón |
|------|-----------|---------|-------|
| Frontend | **Next.js 16** | latest stable | Confirmado bueno con fix de RLS policy + caching explícito |
| Runtime | React 19.2 | latest | OK |
| Lenguaje | TypeScript strict | 5.7+ | Sin sorpresas |
| Estilos | Tailwind 4 | latest | Standard |
| UI primitives | **shadcn/ui + Radix UI** | latest | Copia código = sin lock-in |
| Charts | **Tremor** (Recharts) para 7 widgets MVP | latest | Migrar a ECharts si >5k puntos |
| ORM | **Drizzle** | latest | SQL-first, edge-friendly |
| DB | **PostgreSQL 16** | 16.x | Único target MVP (NO D1) |
| Auth | **better-auth** | latest | Aceptar riesgo con tests de upgrade |
| Estado | **Zustand** (UI) + **TanStack Query** (server) + **zundo** (undo patches) | latest | Separación clara |
| Forms | **react-hook-form** + Zod compartido | latest | Familiar, menos magia |
| Drag-drop | **dnd-kit** (NO react-grid-layout) | latest | 2026 estándar, RGL es apuesta riesgosa |
| AI SDK | **Vercel AI SDK 6** (NO v4) | ai@^6.0.0 | v4 deprecated |
| AI providers | @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google | latest | 3 oficiales, sin community |
| PDF | **Puppeteer en worker service SEPARADO** | latest | Chrome aislado del Next |
| Email | **Resend** (abstracto vía EmailProvider) | latest | DX moderno, abstracción para cambiar |
| Monitoring | **Sentry** + **Pino** + **OpenTelemetry** | latest | Stack estándar 2026 |
| Testing | **Vitest** + **Playwright** + Testcontainers (Postgres) | latest | Cobertura tenant + e2e |
| CI/CD | **GitHub Actions** (lint, typecheck, test, e2e, audit, build) | n/a | Standard |
| Deploy | **Docker Compose** single-node + worker PDF service separado | n/a | Self-hosted simple |

### Arquitectura final

```
┌─────────────────────────────────────────────────────────────┐
│  HOST (Docker Compose)                                       │
│                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐         │
│  │  Next.js 16         │    │  PDF Worker          │         │
│  │  (App principal)    │    │  (Puppeteer)         │         │
│  │  Port: 3000         │←───│  Port: 3001          │         │
│  │  - API routes       │    │  - Chrome headless   │         │
│  │  - Server Actions   │    │  - Render dashboard  │         │
│  │  - RSC              │    │  - Output: PDF       │         │
│  └──────────┬──────────┘    └─────────────────────┘         │
│             │                                                │
│             ↓                                                │
│  ┌─────────────────────┐    ┌─────────────────────┐         │
│  │  PostgreSQL 16      │    │  Redis (opcional)    │         │
│  │  Port: 5432         │    │  Cache LLM responses │         │
│  │  - RLS policies     │    │  (rate limit)        │         │
│  │  - Multi-tenant     │    └─────────────────────┘         │
│  └─────────────────────┘                                     │
└─────────────────────────────────────────────────────────────┘
```

**Por qué worker separado:**
- Chrome añade ~200MB al container
- Exports concurrentes pueden agotar memoria y bloquear requests
- Sandbox aislado, límites de recursos independientes
- Si Puppeteer crashea, no afecta el app principal

---

## Cambios respecto al plan v0.2

| Cambio | Antes (v0.2) | Ahora (v1.0) | Fuente |
|--------|--------------|---------------|--------|
| AI SDK | v4 (mencionado en specs) | **v6** (deprecated v4) | STACK-AUDIT A5 |
| Drag-drop | react-grid-layout | **dnd-kit** (estándar 2026) | STACK-AUDIT A4 |
| Estado | Zustand + zundo | **Zustand + TanStack Query + zundo (solo patches)** | STACK-AUDIT A9 |
| PDF | Puppeteer en Next | **Puppeteer en worker separado** | STACK-AUDIT A3 |
| Server state | (no definido) | **TanStack Query** | STACK-AUDIT |
| Testing | (ausente) | **Vitest + Playwright + Testcontainers** | STACK-AUDIT A10 |
| Monitoring | (ausente) | **Sentry + Pino + OpenTelemetry** | STACK-AUDIT A10 |
| CI/CD | (ausente) | **GitHub Actions** | STACK-AUDIT A10 |
| Email | (no definido) | **Resend + EmailProvider abstraction** | STACK-AUDIT |
| Forms | (no definido) | **react-hook-form + Zod compartido** | STACK-AUDIT |

---

## Plan de implementación (6 semanas)

### Semana 0 (Setup) — ANTES de codear

**Objetivo:** resolver P0 del STACK-AUDIT, no escribir features todavía.

- [ ] **Threat model SQL execution** — definir allowlist de hosts/ports, read-only DB user, timeouts, límites
- [ ] **Tenant RLS integration tests** — Vitest tests que verifican que cross-tenant queries devuelven vacío
- [ ] **AI SDK v6 setup** — package.json + lockfile, validar providers (openai, anthropic, google)
- [ ] **Spike dnd-kit** — POC con 12 widgets, drag, resize, keyboard nav
- [ ] **Arquitectura worker PDF** — Docker Compose con 2 servicios (app + worker)
- [ ] **CI/CD setup** — GitHub Actions workflow (lint, typecheck, test, e2e)

**Entregable:** repo `berriosb/dash-bi` con:
- `package.json` + lockfile + Node 22 LTS pinned
- `docker-compose.yml` con 3 servicios (app, worker, postgres)
- `.github/workflows/ci.yml`
- `vitest.config.ts` + tests básicos
- Threat model documentado en `docs/security/threat-model.md`

### Semana 1 — Foundation

- [ ] Next.js 16 + App Router scaffold
- [ ] Drizzle schema + migraciones iniciales (orgs, users, org_members, data_sources, dashboards, queries, llm_usage, audit_log)
- [ ] better-auth con multi-tenant + magic links + Google OAuth + email verification
- [ ] **withOrgContext() wrapper** + ESLint rule anti-data-leak (REGLAS DE ORO)
- [ ] UI base: shadcn/ui setup, 2 themes (moderno-saas, corporate) con CSS variables
- [ ] Docker Compose funcionando end-to-end
- [ ] Sentry setup + Pino logger + OpenTelemetry traces
- [ ] EmailProvider abstracto + Resend adapter

**Entregable:** app corriendo en localhost con signup + login funcional

### Semana 2 — Conectores + Widgets

- [ ] **Connector interface** + 3 implementaciones (Postgres, Stripe, Sheets)
- [ ] **SQL validation pipeline** (validateQuery: SELECT-only, LIMIT auto-inject, table allowlist)
- [ ] **7 widgets** (kpi, line, bar, pie, area, scatter, table) con Tremor/Recharts
- [ ] **Widget renderer** + grid CSS 12-column responsive
- [ ] **TanStack Query setup** para caching de queries/dashboards
- [ ] **Postgres data source wizard** (UI)
- [ ] **Stripe data source wizard** (UI)
- [ ] **Sheets data source wizard** con OAuth flow

**Entregable:** dashboard manual con widgets reales ejecutando queries contra data source conectado

### Semana 3 — AI layer

- [ ] **AI SDK v6 setup** (validar vs v4 que está deprecated)
- [ ] **AiGateway** wrapper con policy engine (rechaza SQL peligroso)
- [ ] **Multi-LLM router** con 3 providers (OpenAI, Anthropic, Gemini)
- [ ] **AI-genera-dashboards endpoint** con retry logic + structured output (Zod)
- [ ] **Query execution pipeline** (la IA genera query → validate → execute → hidrata widget)
- [ ] **Chat panel** persistente
- [ ] **Edit iterativo** (la IA modifica dashboard existente)
- [ ] **Tests de seguridad** (SQL injection, SSRF, cost runaway)

**Entregable:** usuario puede generar dashboard desde prompt, ve datos REALES

### Semana 4 — Manual editing + UX polish

- [ ] **dnd-kit integration** para drag-and-drop de widgets
- [ ] **Property panel** (sidebar derecho estilo Linear)
- [ ] **Add widget dialog** (selector de los 7 tipos)
- [ ] **Theme switcher** (moderno-saas ↔ corporate, 1 click)
- [ ] **Auto-save** con debounce + status indicator
- [ ] **Undo/redo** con zundo (solo patches, no snapshots completos)
- [ ] **react-hook-form + Zod** para todos los forms

**Entregable:** dashboard editable visualmente, dual mode (view/edit)

### Semana 5 — Export + Sharing

- [ ] **Worker PDF service** (Puppeteer en container separado)
- [ ] **PDF export** con branding de la org
- [ ] **PNG export** con html2canvas
- [ ] **Link público** con token random (sin password)
- [ ] **Audit log** completo (todas las acciones importantes)
- [ ] **Rate limiting** por org (20/200/ilimitado por plan)

**Entregable:** usuario exporta PDF presentable + comparte link público

### Semana 6 — Onboarding + Launch

- [ ] **Onboarding 4 pasos** (signup → welcome → connect source → first dashboard)
- [ ] **Templates pre-hechos** (5-10 dashboards por industria)
- [ ] **README con screenshots**
- [ ] **Docs de deploy** (Docker Compose paso a paso)
- [ ] **Video demo 60s**
- [ ] **Post LinkedIn launch**

**Entregable:** MVP público en GitHub, post de lanzamiento

---

## Decisiones arquitectónicas finales

### Multi-tenant security (P0 — crítico)

**Implementación obligatoria desde día 1:**

1. **Postgres RLS policies** activas en TODAS las tablas tenant-scoped
2. **`withOrgContext(orgId, userId, fn)` wrapper** — TODA query a DB debe pasar por acá
3. **ESLint rule custom** — rechaza `db.select()` directo en `/app/api/`
4. **DB user read-only** para queries generadas por IA (sin permisos DML/DDL)
5. **Tests de aislamiento** — Vitest que verifica cross-tenant isolation

```typescript
// Patrón obligatorio (ya documentado en multi-tenant.md §3.3)
await withOrgContext(orgId, userId, async () => {
  return await db.select().from(dashboardsTable);
});
```

### AI SDK v6 (P0 — crítico)

**Confirmado:**
- v4 está deprecated
- v6 introduce Agent abstraction, tool execution approval, MCP support
- ai@7.0.34 ya en npm (más reciente que v6)
- **Decisión:** usar AI SDK v6 (latest stable) con `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`

**Estructura:**
```typescript
// lib/ai/gateway.ts — wrapper con policy engine
export class AiGateway {
  async generateObject(opts: GenerateObjectOptions) {
    // 1. Validar prompt (no SSRF, no injection)
    // 2. Track usage
    // 3. Llamar provider via Vercel AI SDK v6
    // 4. Validar output (Zod schema)
    // 5. Cost tracking
  }
}
```

### Drag-drop con dnd-kit (P0 — riesgo resuelto)

**Confirmado:**
- `react-grid-layout` es apuesta riesgosa (fricción histórica con React 19)
- **dnd-kit** es estándar 2026 (~2.8M weekly downloads, 6KB core, accesible)
- Pragmatic DnD también válido pero más setup

**Stack:**
- `@dnd-kit/core` + `@dnd-kit/sortable`
- Construir grid semantics propio (12-column)
- Keyboard navigation built-in (dnd-kit lo soporta)
- Touch support built-in

**Trade-off:** más código custom (~2-3 días más vs RGL) pero vale la pena.

### Worker PDF separado (P0 — operacional)

**Decisión:**
- Puppeteer corre en **container separado** (`pdf-worker`)
- Next.js app principal NO tiene Chrome
- Comunicación via HTTP interno (Next → Worker → PDF)
- Worker tiene límites de recursos (CPU, RAM)
- Queue simple (BullMQ + Redis) para manejar concurrencia

**Docker Compose:**
```yaml
services:
  app:
    build: ./app
    ports: ["3000:3000"]
  
  pdf-worker:
    build: ./pdf-worker
    # No expuesto públicamente, solo interno
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
  
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

### Server state con TanStack Query (P1)

**Confirmado:**
- TanStack Query para **server state** (dashboards, data sources, queries ejecutadas)
- Zustand para **UI state** (modo edit/view, panel abierto, selección)
- zundo solo para **undo/redo de patches** (no snapshots completos)

```typescript
// Server state
const { data: dashboard } = useQuery({
  queryKey: ['dashboard', dashboardId],
  queryFn: () => fetchDashboard(dashboardId),
});

// UI state
const { isEditing, selectedWidgetId } = useUIStore();

// Undo/redo (solo patches)
const { undo, redo } = useTemporalDashboardStore(
  (state) => state.temporal,
);
```

---

## Gaps resueltos antes de implementar

### Testing strategy

**Stack:**
- **Vitest** para unit tests (schemas, policies, services)
- **Playwright** para e2e (login → crear dashboard → editar → exportar)
- **Testcontainers** para Postgres en CI (tests de integración reales)
- **Coverage target:** >70% en `/lib`, >50% en `/components`

**Tests críticos:**
- Tenant isolation (cross-tenant queries devuelven vacío)
- SQL injection (queries malformadas rechazadas)
- AI retry logic (después de N retries, error claro)
- Puppeteer worker (timeout, cleanup)
- BYOK encryption (API keys nunca en logs)

### Monitoring

**Stack:**
- **Sentry** para exceptions + performance
- **Pino** para structured logs
- **OpenTelemetry** para distributed tracing
- Correlation IDs en cada request

**Métricas clave:**
- Latency p50/p95/p99 por endpoint
- Tokens consumidos por org/día
- Costo $ por org/día
- Query execution time
- Puppeteer export time
- Errores por provider LLM
- Memory de Puppeteer worker

### CI/CD

**GitHub Actions:**
- `lint` (ESLint)
- `typecheck` (tsc --noEmit)
- `test` (Vitest + Testcontainers Postgres)
- `e2e` (Playwright + browser)
- `audit` (npm audit + OSV scanner)
- `build` (Next.js build)
- `docker-build` (multi-arch images pinned por digest)

**Pre-commit hooks:**
- Husky + lint-staged
- ESLint + Prettier en archivos modificados
- TypeScript check

### BYOK security

**Implementación:**
- AES-256-GCM con master key de env variable (no commit)
- KMS externa opcional (AWS KMS, GCP KMS) para Fase 2
- API keys NUNCA en logs (regex redaction)
- API keys NUNCA en responses (select fields whitelist)
- Rotation manual cada 6 meses (warning en UI)
- Audit log de acceso a keys

---

## Out of scope MVP (confirmado)

❌ Cloudflare D1 / edge deployment
❌ Ollama / minimax LLM providers
❌ Executive / Analyst themes (solo moderno-saas + corporate)
❌ Heatmap / Funnel / Stacked-bar widgets (solo 7)
❌ Link público con password
❌ Fallback template (error claro al usuario después de 3 retries)
❌ Custom widget types via UI
❌ Templates marketplace (Fase 2)
❌ Collaborative editing en tiempo real (Fase 3)
❌ Embed mode para SaaS externos (Fase 3)
❌ Dark mode (Fase 2)
❌ SSO/SAML (Fase 2)
❌ Multiplayer editing (Fase 3)

---

## Roadmap post-MVP

**Fase 2 (semana 7-10):**
- ECharts para datasets grandes (>5k puntos)
- Templates pre-hechos por industria
- Email drip campaign post-signup
- Dark mode
- Custom branding por org
- Más data sources (Shopify, Meta Ads, Notion, MySQL)

**Fase 3 (semana 11-14):**
- Collaborative editing (Yjs/CRDT)
- AI explica cada widget ("Por qué bajó?")
- Embed mode
- SSO/SAML
- Scheduled dashboards + email reports

---

## Veredicto final

**Stack aprobado para implementar.** Las decisiones P0 del STACK-AUDIT están resueltas:

✅ AI SDK v6 (no v4)
✅ dnd-kit (no RGL)
✅ Worker PDF separado
✅ TanStack Query para server state
✅ Testing + monitoring + CI definidos desde día 1
✅ BYOK security desde día 1
✅ Threat model SQL execution antes de codear

**Estimación realista:** 6 semanas para MVP funcional y deployado.

**Próximo paso concreto:** crear repo público `berriosb/dash-bi` y empezar Semana 0 (setup + threat model + spike dnd-kit + setup CI).