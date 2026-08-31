# Feature Specs — dash-bi

> Specs detalladas por feature. Cada spec es un entregable implementable.

**Última actualización:** 2026-08-10 (MVP funcional en estabilización)

> Las casillas de esta lista indican que existe la spec, no que todos sus
> criterios estén verificados. Para el estado de implementación consultar
> [`docs/MVP-STATUS.md`](../docs/MVP-STATUS.md).

## Specs

### Core (v0.3)

- [x] `ai-generate-dashboards.md` — Feature estrella, JSON schema, prompt engineering
- [x] `multi-llm-router.md` — Switch de providers (3 oficiales), configuración por org
- [x] `connectors.md` — Interfaz común, Postgres/Stripe/Sheets implementation
- [x] `query-engine.md` — Pipeline ejecución/validación/cache/hidratación (spec v0.3 dedicado, antes en otros specs)
- [x] `widget-system.md` — 7 tipos de widget, renderer, configs
- [x] `layouts-themes.md` — 2 themes pre-definidos (moderno-saas, corporate)
- [x] `dashboard-archetypes.md` — 8 archetypes + 7 patrones atómicos + 4 axes de variación (v0.4)
- [x] `multi-tenant.md` — Org isolation, RBAC, RLS, caching policy
- [x] `auth.md` — better-auth setup, magic links, sessions
- [x] `export.md` — PDF (worker separado) / PNG / link público sin password
- [x] `onboarding.md` — Flujo "pega tu API key, ya tienes dashboard"
- [x] `manual-editing.md` — Modo Edit: drag-drop (dnd-kit), property panel, auto-save
- [x] `email.md` — EmailProvider abstraction (Resend default)

### Tier 1 competitive features (v0.5, sync 2026-07-22)

- [x] `demo-mode.md` — 3 personas con datos sintéticos (SaaS startup, Ecom, B2B agency)
- [x] `csv-excel-connector.md` — 4º data source: upload CSV/Excel → tabla SQL
- [x] `nlqa.md` — Q&A en lenguaje natural: pregunta → SQL → respuesta + chart

### Operational specs (v0.6, sync 2026-07-22)

- [x] `deployment.md` — Docker Compose, healthchecks, backup/restore, secrets (cierra gap A7/A10 del audit)
- [x] `testing.md` — Vitest + Playwright + Testcontainers, security tests P0, coverage targets (cierra gap A10)
- [x] `errors-ux.md` — Catálogo consolidado de errores (shape, codes, copy en español)
- [x] `scheduled-reports.md` — Cron-like schedules + email delivery (Tier 1 competitivo, reusa PDF worker)

---

## Cambios v0.5 (sync 2026-07-22 — Tier 1 competitive)

Análisis competitivo post-auditoría v1.0 identificó features **que la competencia tiene y dash-bi no**. Las 3 specs nuevas atacan el top-of-funnel:

- ✅ **`demo-mode.md`** — datos sintéticos pre-cargados por signup. Acelera funnel 3-5x (Meta/Preset/Hex lo tienen). Reusa query-engine existente sin cambios arquitecturales.
- ✅ **`csv-excel-connector.md`** — upload CSV/Excel como data source. Abre mercado de usuarios sin DB propia (top-of-funnel masivo). Nuevo connectorType, nueva tabla `uploaded_files`.
- ✅ **`nlqa.md`** — Q&A en lenguaje natural: "¿Cuánto revenue hubo en julio?" → respuesta + chart. Diferenciador estratégico vs Tableau/Metabase. Reusa AI SDK + query-engine + multi-LLM router. Endpoint y pipeline separados de `/dashboards/generate`.

---

## Cambios v0.3 (sync 2026-07-21)

- ✅ Creado **`query-engine.md`** (era gap crítico del audit REPORTE.md §6)
- ✅ `widget-system.md` reducido a 7 widgets (antes 10)
- ✅ `layouts-themes.md` reducido a 2 themes (antes 4)
- ✅ `multi-llm-router.md` reducido a 3 providers oficiales (antes 5)
- ✅ `auth.md` requiere email verification desde día 1
- ✅ `export.md` PDF en worker service separado (Puppeteer NO en Next.js principal)
- ✅ `manual-editing.md` usa `@dnd-kit/core` (antes `react-grid-layout`)

### Tier 2 competitive features (v1.1)

- [x] `embed-mode.md` — Dashboards embebidos en SaaS externos vía iframe + signed token + CSP frame-ancestors

---

## Spec status

**Completos (v1.1):** 13 core + 3 tier-1 + 4 operational + 1 tier-2 = **21 specs**.
**Pendientes Tier 2 (competitivo, no bloqueante):**

- AI explica cada widget ("¿Por qué bajó revenue?")
- Alertas y anomalías (thresholds → Slack/email)
- Semantic metrics layer (definir "revenue" una vez)

Tier 2 pendiente de feedback de early users antes de spec.
**Pendientes Tier 3 (defensa/operación):** API pública + webhooks, white-label + custom domains, multi-idioma completo.

Ver análisis completo en sesión 2026-07-22.
