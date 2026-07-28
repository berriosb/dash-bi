# SPEC — dash-bi

> Especificación completa del producto. Single source of truth.

**Última actualización:** 2026-07-21 (design diversity + post-auditoría + sync de inconsistencias)
**Estado:** Draft v0.4
**Responsable:** codehak

**Cambios v0.4:** Dashboard archetypes (8 curados + 7 patrones atómicos + 4 axes de variación → ~1.400 layouts visualmente distintos). Ver `specs/dashboard-archetypes.md`.

**Cambios v0.3:** Defaults LLM realistas (gpt-4o, claude-3-5-sonnet, gemini-1.5-pro); i18n → español monolingüe en MVP (next-intl removido del middleware); referencia a `query-engine.md` como spec independiente; widget count = 7 confirmado; drag-drop = dnd-kit (no react-grid-layout).

**Cambios v0.2:** 7 widgets (no 10), 2 themes (no 4), 3 LLM providers (no 5), Puppeteer para PDF (no react-pdf), data real en widgets (no ficticia). Ver auditoría completa en `docs/audits/2026-07-21-arquitectura/REPORTE.md`.

---

## 1. Visión

Plataforma open source de Business Intelligence que reemplaza Power BI con:
- Diseños SaaS modernos (no UI legacy de 2010)
- IA generativa que compone dashboards desde prompts en lenguaje natural, **con datos reales del data source conectado**
- **Design diversity** — 8 archetypes + 7 patrones atómicos + 4 axes de variación garantizan que cada dashboard se ve distinto (~1.400 combinaciones)
- Multi-provider LLM switch (3 providers oficiales: OpenAI, Anthropic, Gemini) configurables por organización
- Conectores API-first (Postgres, Stripe, Google Sheets) — setup en minutos
- Self-hosted via Docker Compose (Postgres incluido) — deployable on-prem en cualquier empresa
- Export presentable (PDF con branding via Puppeteer, PNG, link público sin auth)
- Multi-tenant con Row Level Security + RBAC (admin/editor/viewer)
- **Edición manual preservada** — el archetype es punto de partida, el usuario puede editar libremente después (drag-drop, agregar/quitar widgets)

## 2. Usuario objetivo

**Primario:** Bastian (dueño) en su próximo trabajo como empleado, enviando reportes a clientes/jefes.

**Secundario (futuro):** PYMEs y consultoras que necesitan BI sin pagar licencia Microsoft ni SaaS enterprise.

## 3. Feature estrella: AI-genera-dashboards (con datos reales + design diversity)

**Diferencia clave v0.2:** cada widget referencia un `source.kind: 'query'` que se ejecuta server-side contra el data source conectado. **NO** data hardcodeada. Los números que ve el usuario son **reales**.

**Diferencia clave v0.4:** la IA elige entre **8 archetypes** + compone custom con **7 patrones atómicos** + varía en **4 axes**. Combinatoria ≈ 1.400 layouts distintos. El usuario puede pedir *"3 variaciones"* y obtener 3 dashboards estructuralmente diferentes para el mismo data source. Después puede editar manualmente.

Ver specs completos:
- `specs/ai-generate-dashboards.md` — feature estrella end-to-end (incluye 3 few-shot con archetypes distintos)
- `specs/dashboard-archetypes.md` — vocabulario de patrones + 8 archetypes + 4 axes
- `specs/query-engine.md` — pipeline de ejecución, validación, cache, hidratación de widgets
- `specs/manual-editing.md` — edit mode preserva el archetype, permite cambiarlo y editar libremente

## 4. Stack técnico

### Frontend
- **Next.js 16** (App Router) + **React 19.2**
- **TypeScript strict**
- **Tailwind CSS 4**
- **shadcn/ui** (componentes base)
- **Tremor** (charts corporativos, look SaaS moderno)

### Backend
- **Next.js API routes** + **Server Actions**
- **better-auth** (auth + multi-tenant orgs)
- **Drizzle ORM** (typesafe, liviano, edge-friendly)

### Database
- **PostgreSQL 16** (deployable on-prem)
- Schema multi-tenant con `org_id` en cada tabla

### AI
- **Vercel AI SDK v6** con multi-provider router
- Streaming responses para chat
- **LLM providers activos:** OpenAI (`gpt-4o` family), Anthropic (`claude-3-5-sonnet-latest`), Google (`gemini-1.5-pro`)
- Costos en tracking: tabla `MODEL_COSTS` en `multi-llm-router.md` §7.3, editable vía env var

### Export
- **Puppeteer** headless Chrome (PDF con branding de la org, renderiza HTML real)
- **html2canvas** (PNG client-side)
- Link público con token random (sin password)

### Deploy
- **Docker Compose** único (Postgres + Next.js + Puppeteer Chrome incluido)

## 5. Internacionalización (i18n)

**Decisión MVP v0.3:** aplicación monolingüe en **español**. Toda la copy de UI, mensajes de error, emails y docs en español.

**Justificación:**
- Target primario es Bastián en su próximo trabajo en Chile/LatAm
- Reducir scope (STACK-AUDIT §Frontend)
- next-intl removido del middleware (desbloqueaba dev con código no instalado)

**Roadmap Fase 2:** agregar i18n completo (es + en) usando `next-intl` cuando haya tracción. La copy debería estar centralizada desde día 1 en archivos `messages/es.json` para facilitar la migración futura.

**Inconsistencias a corregir en specs:** varios specs tienen copy mezclada en español/inglés. Specs en español, código/tipos de DB en inglés.

---

## 6. Conectores

### MVP (Semana 2)

| Conector | Tipo | Auth | Notas |
|----------|------|------|-------|
| **PostgreSQL genérico** | Database | Connection string | Universal, el más usado |
| **Stripe** | API REST | API key | Casos reales: MRR, churn, revenue |
| **Google Sheets** | API REST | OAuth | Casos reales: data operacional |

### Fase 2 (Post-MVP)

| Conector | Tipo | Notas |
|----------|------|-------|
| Shopify | API REST | E-commerce |
| Meta Ads | API REST | Marketing spend |
| Notion | API REST | Content/ops |
| MySQL | Database | Alternativa a Postgres |

## 7. Multi-tenancy

- Cada `organization` tiene su propio set de: data sources, dashboards, users, LLM provider config, branding
- Row Level Security en Postgres: cada query filtra por `org_id`
- Auth via better-auth con sesiones por org

## 8. Plan de implementación

### Semana 1 — Foundation
- Repo público + scaffolding Next.js 16
- Drizzle schema + migraciones iniciales
- better-auth con multi-tenant orgs + RLS setup
- UI base con shadcn/ui + Tremor + 2 themes
- Docker Compose con Postgres + Next.js + Puppeteer

### Semana 2 — Conectores + Query engine
- 3 conectores P0 (Postgres, Stripe, Google Sheets)
- Query validation pipeline (read-only check para Postgres)
- 7 widgets con Tremor/Recharts
- Sistema de layouts (2 temas: moderno-saas + corporate)

### Semana 3 — AI layer
- Multi-LLM router funcional (3 providers: OpenAI, Anthropic, Gemini)
- AI-genera-dashboards con queries REALES (no data ficticia)
- Chat panel persistente
- Edit iterativo in-place

### Semana 4 — Polish + reports + launch
- Export PDF con Puppeteer (HTML real, fidelidad 100%)
- Export PNG + link público (sin password)
- Onboarding: "pega tu API key de Stripe, ya tienes dashboard"
- README con screenshots
- Post LinkedIn launch

## 9. Diferenciadores vs competencia

**Cuadrante único:** OSS + AI que compone dashboards + multi-LLM + self-hosted + look SaaS moderno.

Análisis de competidores OSS (Metabase, Superset, Lightdash, Grafana, OpenBB, Briefer, Wren AI, Evidence) y SaaS con free tier (Looker Studio) vivido durante el planning phase. Conclusión: nadie combina OSS + self-host + AI generativa de dashboards completos + multi-LLM + look SaaS moderno.

## 10. Riesgos identificados

| Riesgo | Mitigación |
|--------|-----------|
| Chocar con features de Metabase | Metabase no tiene AI generativa ni multi-LLM, ese es el gap |
| Scope creep | Mantener 3 conectores MVP, no 10 |
| LLM devuelve JSON inconsistente | Schema validation + retry + fallback templates |
| Tiempo real 4 semanas → 8 | MVP funcional en semana 3, polish en 4 es bonus |
| Deploy on-prem complicado | Docker Compose bien documentado, Cloudflare como alternativa |

## 11. Métricas de éxito (portfolio)

- Repo público con README decente
- Demo live deployada
- Video demo 60s
- Post LinkedIn con 100+ likes
- 10+ stars en GitHub
- 1 caso de uso real (Bastian lo usa en su próximo trabajo)

---

**Cambios recientes:**
- 2026-07-21: v0.1 — Spec inicial creada, competencia mapeada, stack definido