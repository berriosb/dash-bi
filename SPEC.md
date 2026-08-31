# SPEC — dash-bi

> Especificación completa del producto. Single source of truth.

**Última actualización:** 2026-08-18 (estabilización y cierre del MVP funcional)
**Estado:** v0.6.1 (MVP funcional consolidado)
**Responsable:** codehak

**Cambios v0.6.1:** Sincronización completa con el código implementado: conectores CSV/Excel (`uploaded_files`), MySQL y Shopify operativos; backend de Scheduled Reports (`scheduled-reports.md`) integrado; soporte de modelos LLM rápidos (`gpt-4o-mini`, `gemini-1.5-flash`, `claude-3-5-haiku`) para NLQA (<5s); unificación de formatos delta en widgets KPI con `tabular-nums`.

**Cambios v0.4:** Dashboard archetypes (8 curados + 7 patrones atómicos + 4 axes de variación → ~1.400 layouts visualmente distintos). Ver `specs/dashboard-archetypes.md`.

**Cambios v0.3:** Defaults LLM realistas (gpt-4o, claude-3-5-sonnet, gemini-1.5-pro); i18n → español monolingüe en MVP (next-intl removido del middleware); referencia a `query-engine.md` como spec independiente; widget count = 7 confirmado; drag-drop = dnd-kit (no react-grid-layout).

**Cambios v0.2:** 7 widgets (no 10), 2 themes (no 4), 3 LLM providers (no 5), Puppeteer para PDF (no react-pdf), data real en widgets (no ficticia). Ver auditoría completa en `docs/audits/2026-07-21-arquitectura/REPORTE.md`.

---

## 1. Visión

Plataforma open source de Business Intelligence que reemplaza Power BI con:
- Diseños SaaS modernos (no UI legacy de 2010, filosofía "The Decision Desk")
- IA generativa que compone dashboards desde prompts en lenguaje natural, **con datos reales del data source conectado**
- **Design diversity** — 8 archetypes + 7 patrones atómicos + 4 axes de variación garantizan que cada dashboard se ve distinto (~1.400 combinaciones)
- Multi-provider LLM switch (3 providers oficiales: OpenAI, Anthropic, Gemini) configurables por organización
- Conectores API-first & Database (Postgres, MySQL, Stripe, Google Sheets, CSV/Excel upload, Shopify) — setup en minutos
- Self-hosted via Docker Compose (Postgres + Redis + App + PDF Worker incluidos) — deployable on-prem en cualquier empresa
- Export presentable (PDF con branding via Puppeteer en worker aislado, PNG, link público sin auth)
- Multi-tenant con Row Level Security + RBAC (admin/editor/viewer)
- **Edición manual preservada** — el archetype es punto de partida, el usuario puede editar libremente después (drag-drop con dnd-kit, property panel, agregar/quitar widgets)

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
- `specs/nlqa.md` — Natural-Language Q&A universal con generación de consultas y charts puntuales

## 4. Stack técnico

### Frontend
- **Next.js 16** (App Router) + **React 19.2** con `--webpack`
- **TypeScript strict** 5.7+
- **Tailwind CSS 4** + CSS variables semánticas (`@theme inline`)
- **shadcn/ui + Radix UI** (componentes base)
- **Tremor / Recharts** (charts interactivos corporativos, look SaaS moderno)
- **dnd-kit** (drag-and-drop accesible y fluido)

### Backend
- **Next.js API routes** + **Server Actions**
- **better-auth** (auth + multi-tenant orgs)
- **Drizzle ORM** (typesafe, SQL-first, edge-friendly)
- **BullMQ 5 + Redis 7** (colas asíncronas para reportes programados y PDF)

### Database
- **PostgreSQL 16** (deployable on-prem)
- Schema multi-tenant con `org_id` y RLS activo en cada tabla tenant-scoped
- Conexión obligatoria mediante wrapper `withOrgContext()`

### AI
- **Vercel AI SDK v6** con multi-provider router
- Streaming responses para chat y NLQA
- **LLM providers activos:** 
  - OpenAI (`gpt-4o`, `gpt-4o-mini`)
  - Anthropic (`claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest`)
  - Google Gemini (`gemini-1.5-pro`, `gemini-1.5-flash`)
- Costos en tracking: tabla `MODEL_COSTS` en `multi-llm-router.md` §7.3, editable vía env var

### Export & Reports
- **Puppeteer** headless Chrome en servicio worker aislado (`pdf-worker` container)
- **html2canvas** (PNG client-side)
- Link público con token criptográfico random (sin password)
- Scheduled reports programados vía cron y entregados por email

### Deploy
- **Docker Compose** multi-servicio (Postgres 16 + Redis 7 + Next.js App + PDF Worker)

## 5. Internacionalización (i18n)

**Decisión MVP:** aplicación monolingüe en **español**. Toda la copy de UI, mensajes de error, emails y docs de usuario en español estándar.

**Justificación:**
- Target primario es Bastián en su próximo trabajo en Chile/LatAm
- Reducción de complejidad y consistencia de copy
- Catálogo de errores unificado en `specs/errors-ux.md` con mensajes en español claros y orientados al usuario de negocio

**Roadmap Fase 2:** agregar i18n completo (es + en) usando `next-intl` cuando haya tracción internacional.

---

## 6. Conectores

### Disponibles en MVP

| Conector | Tipo | Auth | Estado |
|----------|------|------|--------|
| **PostgreSQL genérico** | Database | Connection string | Implementado y testeado |
| **MySQL genérico** | Database | Connection string / credenciales | Implementado y testeado |
| **Stripe** | API REST | API key cifrada (BYOK) | Implementado y testeado |
| **Google Sheets** | API REST | OAuth / Service Account | Implementado y testeado |
| **CSV / Excel upload** | Archivos | Upload directo a tabla tenant-scoped | Implementado y testeado |
| **Shopify** | API REST | Store Domain + Access Token | Implementado y testeado |

### Fase 2 (Post-MVP)

| Conector | Tipo | Notas |
|----------|------|-------|
| Meta Ads | API REST | Marketing spend y atribución |
| Notion | API REST | Bases de datos de operaciones |

## 7. Multi-tenancy

- Cada `organization` tiene su propio set de: data sources, dashboards, users, LLM provider config, branding, uploaded files y audit logs.
- Row Level Security en Postgres: cada query a tablas de tenant exige `app.current_org_id`.
- Auth via better-auth con aislamiento estricto y selector dinámico de organización activa.

## 8. Plan de implementación consolidado

### Semana 1 — Foundation (Cerrado)
- Repo + scaffolding Next.js 16 + TypeScript strict
- Drizzle schema + migraciones + RLS policies
- better-auth con multi-tenant orgs + permissions RBAC
- UI base con shadcn/ui + temas `moderno-saas` y `corporate`
- Docker Compose multi-container

### Semana 2 — Conectores + Query engine (Cerrado)
- Conectores Postgres, MySQL, Stripe, Sheets, CSV/Excel, Shopify
- Query validation pipeline (`validate-query` SELECT-only, SSRF prevention)
- 7 widgets con Tremor/Recharts y HighDensityChart
- Sistema de layouts y responsive grid

### Semana 3 — AI layer + NLQA (Cerrado)
- Multi-LLM router funcional (OpenAI, Anthropic, Gemini) con BYOK
- AI-genera-dashboards con queries reales
- Endpoint `/api/nlqa/ask` para consultas conversacionales directas
- Edit iterativo in-place y auto-save con debounce

### Semana 4 — Export + Polish + Operaciones (Cerrado)
- Worker PDF Puppeteer aislado + colas BullMQ
- Export PNG + Links públicos auditables
- Cron de Scheduled Reports y delivery de email
- Onboarding interactivo y catálogo de templates

## 9. Diferenciadores vs competencia

**Cuadrante único:** OSS + AI que compone dashboards con datos reales + multi-LLM router + self-hosted + look SaaS moderno "The Decision Desk".

## 10. Métricas de éxito

- Repositorio con calidad estricta (0 warnings, tests verdes)
- Demo interactivo con datos sintéticos (SaaS, E-commerce, Agencia)
- Video demo 60s
- Export de reportes PDF de alta fidelidad con branding listo para clientes/jefes