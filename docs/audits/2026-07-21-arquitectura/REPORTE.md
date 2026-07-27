# Reporte de Auditoría Arquitectónica — dash-bi

**Fecha:** 2026-07-21
**Auditor:** codehak (con contexto del subagente `spec-audit-remediation`)
**Alcance:** 10 specs en `/home/bastian-berrios/Proyectos/dash-bi/specs/` + SPEC.md + docs/architecture.md
**Método:** Lectura completa de cada spec + búsqueda de referencias cruzadas + web research de competidores + comparación con alternativas OSS (Wren AI 16.5k stars, Metabase Metabot AI, Briefer, Omni/ThoughtSpot)

---

## TL;DR

**Estado general:** Specs sólidos y bien pensados. Stack coherente, feature estrella bien definida (AI-genera-dashboards), diferenciador claro vs competencia.

**Pero hay 6 problemas críticos que pueden romper el producto o hacerlo inviable:**

1. 🔴 **Contradicción arquitectónica:** SPEC.md y architecture.md dicen "Cloudflare Pages + D1", pero todos los specs asumen Postgres completo (RLS, multi-tenant, joins complejos). D1 es SQLite — sin RLS nativo, sin muchas features Postgres.
2. 🔴 **Dead-on-arrival feature:** AI-genera-dashboards devuelve `data` hardcodeada con ejemplos. El usuario ve un dashboard hermoso pero con números falsos. Eso destruye la confianza.
3. 🔴 **Falta definir el query engine:** ai-generate-dashboards depende de `source.kind: 'inline'` con data ficticia, pero el feature estrella REAL es conectar data real. Sin query engine, el producto es un demo.
4. 🔴 **Decisión multi-LLM sin validación:** 5 providers en MVP es scope creep masivo. minimax provider oficial no existía hasta hace poco (verificado). Ollama en MVP retrasa 2 semanas.
5. 🟠 **Race condition en RLS:** `SET LOCAL` solo vive dentro de la transacción. Si la app usa connection pooling mal, las policies se rompen silenciosamente.
6. 🟠 **PDF rendering de charts Recharts es prácticamente imposible** sin reescribir cada chart en react-pdf. Estimado: +2 semanas de trabajo no contempladas.

**Recomendación:** Antes de codear, resolver estos 6 + decidir 4 simplificaciones críticas abajo. Si no, el MVP va a tomar 8-12 semanas, no 4.

---

## 1. Decisiones arquitectónicas subóptimas vs competencia

### 🔴 CRÍTICO: Contradicción Postgres vs D1/SQLite

**Descripción:** Los specs asumen Postgres 16 con RLS, jsonb, `SET LOCAL`, pero la documentación de arquitectura propone Cloudflare D1 como alternativa edge. **D1 es SQLite**, no Postgres. No tiene:
- Row Level Security nativo
- `SET LOCAL` para variables de sesión
- `jsonb` (tiene `json` sin índices GIN)
- Joins complejos performantes

**Evidencia:**
- `architecture.md` líneas 139-148: "Opción B: Cloudflare Pages + Workers + D1 + Hyperdrive"
- `multi-tenant.md` línea 80: "ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY" — **no funciona en SQLite**
- `multi-tenant.md` línea 113: `SET LOCAL app.current_org_id` — **no funciona en SQLite**
- `multi-llm-router.md` línea 135: "Cloudflare Workers Secrets" — implica Workers, no Node server

**Impacto:** Si van a Cloudflare D1, **toda la arquitectura multi-tenant está mal**. Hay que rediseñar con filtros a nivel aplicación.

**Recomendación:** **Eliminar D1 del scope MVP**. Comprometerse con Postgres + Node runtime. Cloudflare puede quedar como futuro con Hyperdrive + Postgres externo. Pero no ahora.

---

### 🟠 ALTO: 5 LLM providers en MVP = scope creep innecesario

**Descripción:** multi-llm-router.md soporta OpenAI + Anthropic + Gemini + minimax + Ollama. Cada provider requiere testing, manejo de errores, billing, docs. Para MVP eso es mucho.

**Evidencia:**
- `multi-llm-router.md` líneas 38-49: tabla con 5 providers
- Líneas 157-176: capabilities matrix para cada uno
- Líneas 336-345: docker-compose con GPU para Ollama

**Comparación con competencia:**
- **Wren AI** soporta 10+ providers pero está en mercado hace 2+ años
- **Metabase Metabot** solo soporta OpenAI (los demás son BYOK interno)
- **Briefer** soporta configurable pero default OpenAI

**Impacto:** 5 providers = 5 SDKs que mantener, 5 rate limits, 5 quirks de JSON mode. Estimado: +1.5 semanas de trabajo vs 2 providers.

**Recomendación:** **MVP con 2 providers** — OpenAI + Anthropic (los más confiables para JSON mode). Agregar Gemini y minimax en semana 5+. Ollama en semana 6+ cuando el resto esté estable.

---

### 🟠 ALTO: 4 themes en MVP = demasiado

**Descripción:** layouts-themes.md define 4 themes (moderno-saas, corporate, executive, analyst) con palettes, fonts, spacing, shadows, chart styles cada uno.

**Evidencia:**
- `layouts-themes.md` líneas 30-280: 4 themes completos con tokens
- Líneas 281-380: implementación con CSS variables + `getComputedStyle` para Recharts

**Comparación con competencia:**
- **Metabase** tiene 1-2 themes (light/dark) y nadie se queja
- **Wren AI** tiene 1 theme
- **Tableau** tiene 1 theme + custom branding

**Impacto:** 4 themes × 5 charts = 20 combinaciones a testear visualmente. Tiempo de implementación real: +1 semana solo para que se vean bien.

**Recomendación:** **MVP con 2 themes** — `moderno-saas` (default) + `corporate` (formal). Executive y analyst en Fase 2. La IA puede elegir entre 2 sin problema.

---

### 🟡 MEDIO: Postgres como DB pero se vende "edge-first"

**Descripción:** SPEC.md línea 18 dice "Self-hosted via Docker o deploy edge en Cloudflare". La narrativa es dual (on-prem + edge), pero técnicamente solo on-prem funciona limpio.

**Evidencia:**
- SPEC.md menciona Cloudflare Pages como deploy alternativo
- architecture.md tiene "Opción A: Docker" y "Opción B: Cloudflare"
- Todos los specs asumen Postgres tradicional

**Impacto:** Confusión de positioning. Mejor comprometerse con una opción para MVP.

**Recomendación:** **Story claro**: "dash-bi se deploya con Docker Compose (Postgres incluido)". Edge deployment se menciona como "roadmap Fase 3". Esto evita scope creep de "soportar ambos runtimes".

---

### 🟡 MEDIO: Custom provider para minimax es un riesgo

**Descripción:** multi-llm-router.md línea 320 dice "Si minimax ya tiene provider oficial al momento de implementar, usamos ese". El subagente verificó que el provider oficial existe pero es "community" (no oficial de MiniMax).

**Evidencia:**
- Web search encontró: `github.com/MiniMax-AI/vercel-minimax-ai-provider` — community, no oficial
- `multi-llm-router.md` líneas 213-247: implementa wrapper custom de todas formas

**Impacto:** Provider community puede tener bugs, breaking changes, o abandonware. Dependencia riesgosa para MVP.

**Recomendación:** **Sacar minimax del MVP**. OpenAI + Anthropic + Gemini con providers oficiales son suficientes. minimax en Fase 2 cuando haya provider oficial estable.

---

## 2. Riesgos técnicos no contemplados

### 🔴 CRÍTICO: AI devuelve `data` ficticia — el usuario ve números falsos

**Descripción:** ai-generate-dashboards.md dice que la IA devuelve `source.kind: 'inline'` con data hardcodeada. El usuario abre su dashboard de "Revenue de Stripe últimos 6 meses" y ve $234,500. Pero esos números son **inventados por la IA**.

**Evidencia:**
- `ai-generate-dashboards.md` línea 526: "Decisión MVP: la IA devuelve widgets con source.kind: 'inline' y data calculada por la IA o sampleada"
- Ejemplo 1 (líneas 311-401): datos hardcodeados con valores específicos como `45230, 12.5` etc.
- `widget-system.md` línea 105: `DataSource = { kind: 'inline'; data: unknown }`

**Impacto:** Esto **destruye la confianza del usuario**. Un gerente ve el dashboard y dice "esto no es real, ¿de dónde sacaste estos números?". El producto se vuelve un demo inútil, no una herramienta de trabajo.

**Comparación con competencia:**
- **Wren AI** genera SQL real que ejecuta contra el data source. Números son reales.
- **Metabase Metabot** genera SQL real.
- **Briefer** ejecuta queries reales en el notebook.

**Recomendación:** **NO shippear con `source.kind: 'inline'` para data**. En MVP, la IA debe generar **el query** (SQL o API call) que se ejecuta contra el data source real. Los datos que se muestran son reales. Sin esto, el producto no sirve.

**Tradeoff honesto:** Esto agrega complejidad significativa (la IA debe generar SQL correcto, hay que validar, hay que ejecutar). Pero es la única forma de tener un producto real. Si querés simplificar, hacer MVP solo con queries pre-definidas (templates) y que la IA elija entre esos templates.

---

### 🔴 CRÍTICO: Query engine no está especificado

**Descripción:** connectors.md define `executeQuery()` para PostgreSQL y Stripe. Pero ai-generate-dashboards.md no define cómo la IA invoca ese executeQuery cuando quiere datos. El feature estrella no tiene query engine.

**Evidencia:**
- `connectors.md` línea 90: `executeQuery<T>(query: Query): Promise<QueryResult<T>>`
- `ai-generate-dashboards.md` no menciona executeQuery
- `ai-generate-dashboards.md` línea 526: "Roadmap Fase 2: source.kind: 'query' → la IA genera SQL/API call que ejecuta contra el data source real"

**Impacto:** Sin query engine, el feature estrella es solo una demo visual. Para que funcione real, hay que especificar:
- Cómo la IA genera SQL/API calls
- Cómo se valida que el SQL no es destructivo
- Cómo se cachean resultados
- Cómo se manejan errores de query
- Cómo se actualizan los datos (live vs cache)

**Recomendación:** **Spec dedicado `query-engine.md`** antes de codear. Define el flujo completo: prompt → IA genera query → validación → ejecución → resultado. Sin esto, ai-generate-dashboards es teatro.

---

### 🟠 ALTO: Race condition en RLS con connection pooling

**Descripción:** multi-tenant.md usa `SET LOCAL` que solo vive dentro de la transacción. Si Next.js hace un query "raw" fuera de la transacción (sin `withOrgContext`), las policies no se aplican y se filtra data cross-tenant.

**Evidencia:**
- `multi-tenant.md` línea 113: `SET LOCAL app.current_org_id = ${orgId}`
- Línea 116: "Scoped a esta transacción"
- Pero no hay enforcement a nivel ORM que TODA query pase por `withOrgContext`

**Comparación:** Soluciones como Supabase usan claims de JWT a nivel connection, no SET LOCAL. Más seguro.

**Impacto:** **Bug de seguridad crítico** — un developer olvida `withOrgContext` y toda la data de todas las orgs es visible. Difícil de detectar en code review.

**Recomendación:** **Patrón obligatorio**: TODA query a DB pasa por un wrapper que automáticamente setea el org context. Linter rule que rechaza queries directas a `db.select()`. O usar Supabase RLS con JWT claims que es más seguro.

---

### 🟠 ALTO: PDF rendering de charts interactivos es problemático

**Descripción:** export.md asume que se puede renderizar LineChart, BarChart, PieChart (Recharts) en PDF usando `@react-pdf/renderer`. **Recharts usa SVG que no es soportado nativamente por react-pdf**. Hay que reimplementar cada chart en primitives de react-pdf.

**Evidencia:**
- `export.md` líneas 86-89: dice que Tremor/Recharts se renderiza en PDF
- Pero react-pdf renderiza con sus propios primitives (View, Text, etc.)
- Web search confirmó: "react-pdf limitations: no SVG, no CSS animations"

**Comparación:**
- **Metabase** genera PDFs server-side con wkhtmltopdf o headless Chrome
- **Tableau** usa su propio engine de PDF

**Impacto:** Cada chart en react-pdf es trabajo custom. Estimado:
- KPI: 30 min
- LineChart: 2-3 horas (puntos, ejes, leyenda)
- BarChart: 1-2 horas
- PieChart: 1 hora
- Heatmap: 3-4 horas
- Funnel: 1 hora
- Table: 30 min
- Total: ~2 semanas solo para charts PDF

**Recomendación:** **Dos opciones:**
- **A) Sacrificar fidelidad PDF:** PDF muestra solo KPIs + tablas + texto, NO charts. Charts dicen "ver versión web". Aceptable para MVP.
- **B) Usar headless Chrome (Puppeteer):** renderiza el dashboard real como HTML y lo exporta a PDF. Mucho más fiel pero requiere Chrome corriendo (~200MB). Más complejo de deployar.

Recomiendo **B) Puppeteer** porque el PDF es la feature estrella para "enviar reportes".

---

### 🟠 ALTO: Ollama en MVP retrasa deploy significativamente

**Descripción:** multi-llm-router.md incluye Ollama como provider. Ollama requiere:
- Binario de ~200MB
- Modelos de 4-70GB descargados
- GPU recomendada (CPU es 10-50x más lento)
- Setup de Docker Compose con GPU passthrough

**Evidencia:**
- `multi-llm-router.md` líneas 336-345: docker-compose con nvidia runtime
- Líneas 192-200: modelos de 8-70GB

**Impacto:** El "self-host 100% sin datos saliendo" es killer feature para enterprise, pero agregar Ollama al MVP retrasa 2 semanas el setup + testing + docs.

**Recomendación:** **Sacar Ollama del MVP**. Documentar como "soporte Ollama en roadmap" pero no implementar. El usuario que quiera 100% on-prem puede esperar Fase 2, o contribuir el provider.

---

### 🟡 MEDIO: Magic links sin verificación de email es riesgo

**Descripción:** auth.md línea 56 dice `requireEmailVerification: false`. Eso significa que cualquiera con acceso a un email puede crear cuenta.

**Evidencia:**
- `auth.md` línea 56: "requireEmailVerification: false, por ahora, MVP"

**Impacto:** Spam accounts, typos en emails crean cuentas perdidas. Para B2B no es crítico, pero es sloppy.

**Recomendación:** Requerir verificación de email desde día 1. Es 1 día de trabajo extra (enviar email + página de verificación).

---

### 🟡 MEDIO: Rate limit en `app/api/auth` global, no por endpoint

**Descripción:** auth.md línea 78 dice "max: 30" general, pero solo `/sign-in/email`, `/sign-up/email`, `/magic-link/send` tienen custom rules. `/forgot-password`, `/reset-password` (Fase 2) no están limitados.

**Evidencia:**
- `auth.md` líneas 73-79: rules custom solo para 3 endpoints

**Impacto:** Endpoints no limitados pueden ser vector de ataque cuando se agreguen en Fase 2.

**Recomendación:** Agregar `/forgot-password`, `/verify-email`, `/oauth/callback` a custom rules desde MVP.

---

### 🟡 MEDIO: Plan quota `enterprise = -1` causa overflow bugs

**Descripción:** multi-tenant.md líneas 263-269 usa `-1` para ilimitado. Pero el código que checkea quota hace `if (limit === -1) return true` — ¿qué pasa con otros valores negativos? ¿O si el JSON se serializa y el `-1` se vuelve string?

**Evidencia:**
- `multi-tenant.md` línea 264: `members: -1` para ilimitado
- Línea 285: `if (limit === -1) return true`

**Impacto:** Edge cases. Probablemente OK en práctica pero sloppy.

**Recomendación:** Usar `Number.POSITIVE_INFINITY` o un enum `LIMIT.UNLIMITED`. Más explícito.

---

### 🟢 BAJO: better-auth es OSS pero tiene menos examples que NextAuth

**Descripción:** Stack decision fue "better-auth sobre NextAuth: más moderno, mejor DX". Pero NextAuth tiene 10x más tutoriales, Stack Overflow answers, y casos de uso documentados.

**Evidencia:**
- `architecture.md` línea 156: "better-auth sobre NextAuth"

**Impacto:** Si te stuckeás con better-auth a las 2am, hay menos recursos. Pero la API es más limpia.

**Recomendación:** Mantener better-auth (es la decisión correcta), pero documentar bien las decisiones no-obvias en `auth.md`.

---

## 3. Oportunidades de simplificación

### 🟠 ALTO: Eliminar features que están en specs pero no aportan al MVP

**Lo que sobra del MVP:**

| Feature | Spec | Por qué sacar |
|---------|------|---------------|
| Link público con password | export.md §5 | Complejo, edge case raro. Token random es suficiente para MVP. |
| Auto-creación de org en signup | onboarding.md §4 | Útil pero no crítico. Usuario puede crear org manual. |
| 4 themes (solo 2 necesarios) | layouts-themes.md | Ver §1 arriba. |
| 5 LLM providers (solo 2-3) | multi-llm-router.md | Ver §1 arriba. |
| Source.kind: 'computed' (Fase 2) | widget-system.md | Nunca se usa. Solo `inline` y `query` (cuando exista). |
| Heatmap widget | widget-system.md | Casi nadie lo pide en MVP. Sacar. |
| Funnel widget | widget-system.md | Útil pero específico. Sacar. |
| Stacked-bar widget | widget-system.md | Redundante con bar-chart. Sacar. |
| Scatter widget | widget-system.md | Caso de uso nicho. Sacar. |

**Impacto:** Sacar 3-4 widgets + 2 themes + 3 providers = ~1.5 semanas menos de trabajo. Producto más enfocado.

**Recomendación:** MVP con **8 widgets** (kpi, line, bar, pie, area, table, scatter-stacked-bar-heatmap-funnel en Fase 2) + **2 themes** + **3 providers** (OpenAI, Anthropic, Gemini).

---

### 🟡 MEDIO: Specs demasiado largos para implementar

**Descripción:** Cada spec tiene 200-700 líneas con código TypeScript completo, ejemplos JSON completos, secciones de "out of scope", "riesgos", etc. Eso es 80% diseño + 20% implementación.

**Evidencia:**
- `connectors.md`: 869 líneas
- `ai-generate-dashboards.md`: 720 líneas
- Total specs: ~5,500 líneas

**Impacto:** Más tiempo leyendo que codeando. Specs no se actualizan cuando cambia el código.

**Recomendación:** Specs más cortos (~200 líneas cada uno) con:
- Interface/types (lo que se mantiene)
- Acceptance criteria
- Out of scope
- NO código completo (eso va al implementar)

---

## 4. Oportunidades de diferenciación no aprovechadas

### 🟠 ALTO: Falta el "AI explica el dashboard" — feature WOW

**Descripción:** Ningún BI OSS tiene esto. dash-bi podría: "Por qué Revenue bajó 12% en julio?" → la IA analiza los datos y propone hipótesis ("porque el plan Pro bajó 23% en ese mes"). Esto es lo que hace un analista real.

**Comparación:** Omni tiene "AI explanations" pero es SaaS. Wren AI no lo tiene.

**Impacto:** Si funciona, es la feature que diferencia a dash-bi de TODO el mercado (OSS y SaaS).

**Recomendación:** Agregar a ai-generate-dashboards.md como Fase 2 del feature estrella. En MVP, el usuario puede hacer click en un KPI y la IA explica qué es.

---

### 🟠 ALTO: Falta "share + collaborate" — multiple usuarios editando

**Descripción:** Briefer tiene multiplayer editing (como Notion). Ningún otro BI OSS tiene esto en tiempo real.

**Comparación:** Briefer = Notion para datos. Metabase, Wren AI = single-user editing.

**Impacto:** Diferenciador claro para equipos. Pero implementación con CRDT/Yjs es +2-3 semanas.

**Recomendación:** NO en MVP. Documentar como killer feature para Fase 3.

---

### 🟡 MEDIO: Falta "templates marketplace" — dashboards pre-hechos

**Descripción:** dash-bi podría tener una galería de dashboards templates por industria/rol: "Ecommerce revenue", "SaaS metrics", "Marketing funnel". La IA los usa como base y los customiza.

**Comparación:** Tableau Public tiene esto. Metabase tiene "official dashboards" examples.

**Impacto:** Reduce time-to-first-value dramáticamente. Usuario nuevo ve templates, elige uno, lo adapta. Sin esto, cada usuario arranca de cero.

**Recomendación:** Crear 5-10 templates pre-hechos ANTES de launch. Es 2-3 días de trabajo pero multiplica el valor percibido.

---

### 🟡 MEDIO: Falta "embed mode" para SaaS que usan dash-bi

**Descripción:** Un SaaS que usa dash-bi podría embeber dashboards dentro de su propia app (como Metabase Embedding SDK). Es un revenue stream enterprise.

**Comparación:** Metabase Embedding SDK. Lightdash tiene embed mode.

**Impacto:** Feature Fase 2-3, no MVP. Pero importante mencionar para el positioning ("dash-bi puede correr embedded").

**Recomendación:** Out of MVP. Roadmap Fase 2.

---

## 5. Performance / scaling issues que aparecerán

### 🟠 ALTO: System prompt con schema completo = 3,000+ tokens cada request

**Descripción:** ai-generate-dashboards.md línea 137 dice "System prompt: ~3,000 tokens (schema + contexto)". Cada generación consume 3K tokens solo de prompt.

**Evidencia:**
- `ai-generate-dashboards.md` línea 547: "System prompt: ~3,000 tokens"

**Impacto:** Costo alto por generación. Latency aumenta. Cache de prompt ayuda pero no resuelve todo.

**Comparación:** Wren AI usa "semantic layer" (MDL) que es MUCHO más compacto que schema completo. Eso reduce tokens 5-10x.

**Recomendación:** **No incluir schema completo en cada prompt**. En su lugar:
1. Schema del data source específico (no todos)
2. Few-shot examples relevantes al tipo de dashboard
3. Templates pre-calculados que la IA solo edita

Estimado: reducción a ~1,000 tokens = 3x más barato.

---

### 🟡 MEDIO: PostgreSQL `getSchema()` puede tardar mucho en DB grandes

**Descripción:** connectors.md `getSchema()` hace query a `information_schema` con todos los columns. En una DB con 500 tablas, eso son miles de rows.

**Evidencia:**
- `connectors.md` líneas 234-260: getSchema() itera tablas y columns

**Impacto:** Cache resuelve. Pero el primer `getSchema()` puede tardar 5-10s en DBs grandes. UI debería mostrar "loading schema...".

**Recomendación:** Especificar timeout + cache obligatorio con TTL 24h.

---

### 🟡 MEDIO: Audit log crece infinito

**Descripción:** multi-tenant.md tabla `audit_log` no tiene retention policy. Cada dashboard.exported, cada datasource.connected crea un row.

**Evidencia:**
- `multi-tenant.md` línea 207-218: tabla audit_log sin retention

**Impacto:** En 1 año con 100 orgs activas, fácilmente 1M+ rows. Queries lentas.

**Recomendación:** Especificar partitioning por mes + retention 90 días (configurable por org en enterprise).

---

### 🟡 MEDIO: `data_sources.schemaCache` puede ser muy grande

**Descripción:** En Postgres con 500 tablas, el schema JSON puede ser 100KB+. Guardar eso en `jsonb` por data source es caro.

**Evidencia:**
- `multi-tenant.md` línea 124: `schemaCache: jsonb('schema_cache')`

**Impacto:** Storage caro, queries lentas si se hace SELECT * sobre la tabla.

**Recomendación:** Cachear en Redis o filesystem, no en DB. O comprimir.

---

## 6. Falta de specs

### 🔴 CRÍTICO: No existe spec de `query-engine.md`

**Descripción:** Para que AI-genera-dashboards funcione REAL (no con data ficticia), necesitamos:
- Cómo la IA genera SQL/API calls
- Validación de SQL (read-only, syntax check)
- Cache de resultados
- Error handling (query timeout, syntax error, no permission)
- Refresh strategy (live vs cached)

**Sin este spec, AI-genera-dashboards es teatro.**

**Recomendación:** Escribir `query-engine.md` ANTES de codear.

---

### 🟠 ALTO: No existe spec de deployment / DevOps

**Descripción:** No hay spec que defina:
- Cómo se deploya en Cloudflare/Vercel/on-prem
- Cómo se hace CI/CD
- Cómo se manejan secrets en prod
- Cómo se monitorea
- Cómo se hace backup de Postgres

**Recomendación:** Crear `specs/deployment.md` antes de implementar.

---

### 🟠 ALTO: No existe spec de testing strategy

**Descripción:** No hay estrategia clara:
- Unit tests con qué coverage?
- Integration tests con qué DB?
- E2E tests con qué framework?
- Cómo se mockea el LLM para tests deterministas?

**Recomendación:** Crear `specs/testing.md` (1 página, simple).

---

### 🟡 MEDIO: No existe spec de error handling / UX de errores

**Descripción:** Qué muestra la UI cuando:
- El LLM falla 3 veces (fallback template OK, pero qué más?)
- El data source está caído
- La API key del LLM es inválida
- El query tarda 30s y timeout
- El usuario excede quota

**Recomendación:** Agregar sección "Error UX" a cada spec relevante.

---

### 🟡 MEDIO: No existe spec de i18n / localización

**Descripción:** Mensajes de UI están en español en algunos specs, inglés en otros. No hay decisión clara.

**Evidencia:**
- `onboarding.md` línea 88: "Mis organización" (español)
- `auth.md` línea 67: "dash-bi" en email subject (inglés)

**Recomendación:** Decidir: español primero o inglés primero. Documentar en `SPEC.md`.

---

### 🟡 MEDIO: No existe spec de observability / logging

**Descripción:** Cómo se loguean errores? Sentry? Datadog? Self-hosted? No hay decisión.

**Recomendación:** Mencionar en `deployment.md`.

---

## 7. Inconsistencias entre specs

### 🟡 MEDIO: Provider minimax — nombre inconsistente

**Descripción:** Algunos specs dicen `minimax`, otros `MiniMax`, otros `minimax-chat`.

**Evidencia:**
- `multi-llm-router.md` línea 44: "minimax"
- Línea 70: `minimax('M2.7')`
- SPEC.md: "minimax"

**Recomendación:** Estandarizar. `minimax` (todo minúscula) en código, "MiniMax" en marketing.

---

### 🟡 MEDIO: Widget `data` source inconsistente

**Descripción:**
- `widget-system.md` define `DataSource = inline | query | computed`
- `ai-generate-dashboards.md` dice MVP es solo `inline`
- `connectors.md` define `Query = sql | stripe | sheets`

No está claro cómo `widget.source.kind: 'query'` mapea a `connector.executeQuery()`. Falta el glue.

**Recomendación:** Crear mapping explícito en `query-engine.md`.

---

### 🟡 MEDIO: Timeouts contradictorios

**Descripción:**
- `connectors.md` línea 244: `statement_timeout: 30000` (30s) para Postgres
- `ai-generate-dashboards.md` línea 547: "Latencia objetivo: <8 segundos para dashboard con 6 widgets"

El query timeout es 30s pero el LLM target es 8s. ¿Si el query tarda 25s, el dashboard se considera lento? ¿O se considera aceptable?

**Recomendación:** Definir budget end-to-end: LLM (5s) + query (3s) + render (1s) = 9s max.

---

### 🟢 BAJO: Nombres de tablas Postgres inconsistentes

**Descripción:**
- `multi-tenant.md` línea 35: `org_members`
- `architecture.md`: no lo nombra explícitamente

Pero otros specs podrían usar nombres diferentes. No hay schema canónico.

**Recomendación:** Centralizar schema en un solo lugar (`db/schema.ts` generado desde docs).

---

## 8. Resumen priorizado

### 🔴 CRÍTICOS (bloquean MVP)

| # | Issue | Spec afectado | Esfuerzo fix |
|---|-------|---------------|--------------|
| 1 | Contradicción Postgres vs D1 | SPEC.md, architecture.md | 1 hora (decisión + actualización) |
| 2 | AI devuelve data ficticia | ai-generate-dashboards.md | Reescribir feature (3-5 días) |
| 3 | Query engine no existe | (falta spec) | Crear spec (1 día) |

### 🟠 ALTOS (retrasan MVP significativamente)

| # | Issue | Spec afectado | Esfuerzo fix |
|---|-------|---------------|--------------|
| 4 | 5 LLM providers en MVP | multi-llm-router.md | Reducir a 2-3 (30 min) |
| 5 | 4 themes en MVP | layouts-themes.md | Reducir a 2 (1 hora) |
| 6 | Race condition en RLS | multi-tenant.md | Wrapper obligatorio (1 día) |
| 7 | PDF rendering de charts | export.md | Decidir Puppeteer (1 día setup + 2 días impl) |
| 8 | Ollama en MVP | multi-llm-router.md | Sacar del MVP (10 min) |
| 9 | System prompt muy grande | ai-generate-dashboards.md | Optimizar (2 días) |
| 10 | Falta spec query-engine.md | (crear) | 1 día |
| 11 | Falta spec deployment.md | (crear) | 1 día |
| 12 | Falta spec testing.md | (crear) | 2 horas |

### 🟡 MEDIOS (mejorables)

| # | Issue | Spec afectado |
|---|-------|---------------|
| 13 | Postgres "edge-first" confuso | SPEC.md |
| 14 | minimax provider riesgo | multi-llm-router.md |
| 15 | Email verification no requerido | auth.md |
| 16 | Rate limit incompleto | auth.md |
| 17 | Plan quota -1 sloppy | multi-tenant.md |
| 18 | better-auth menos docs | (decisión OK, doc mejor) |
| 19 | getSchema() en DB grandes | connectors.md |
| 20 | Audit log retention | multi-tenant.md |
| 21 | schemaCache muy grande | multi-tenant.md |
| 22 | Falta error UX specs | varios |
| 23 | Falta i18n decisión | SPEC.md |
| 24 | Falta observability spec | deployment |
| 25 | Provider name inconsistente | varios |
| 26 | DataSource vs Query mapping | varios |
| 27 | Timeouts contradictorios | varios |

### 🟢 BAJOS (nice-to-have)

| # | Issue |
|---|-------|
| 28 | Widgets redundantes (heatmap, funnel, scatter) |
| 29 | Specs demasiado largos |
| 30 | "AI explica el dashboard" — feature WOW Fase 2 |
| 31 | Templates marketplace — pre-launch |
| 32 | Multiplayer editing Fase 3 |
| 33 | Embed mode Fase 2 |

---

## 9. Recomendación final

**El MVP tal como está especificado va a tomar 8-12 semanas, no 4.**

Para llegar a 4-5 semanas:

1. **Resolver los 3 críticos** (1 hora + 3-5 días + 1 día = ~1 semana)
2. **Aplicar las 9 simplificaciones altas** (2-3 horas de decisión + impacto en código de 1-2 semanas)
3. **Reducir scope visible:**
   - 8 widgets en vez de 10
   - 2 themes en vez de 4
   - 3 LLM providers en vez de 5
   - 3 connectors en vez de esperar más
4. **NO incluir:**
   - Link público con password
   - Ollama
   - Custom provider minimax
   - Dark mode
   - Embed mode
   - Multiplayer

**Lo que SÍ debe estar en MVP (no negociable):**
- AI-genera-dashboards CON data real (no ficticia)
- 3 connectors reales (Postgres, Stripe, Sheets)
- Multi-tenant con RLS seguro
- Auth + email verification
- Export PDF básico (con Puppeteer, no react-pdf para charts)
- Link público sin password
- 2 themes (moderno-saas + corporate)
- 3 LLM providers (OpenAI + Anthropic + Gemini)

**Estimación real después de aplicar cambios:** 4-5 semanas para MVP funcional.

---

## 10. Lo que el subagente alcanzó a verificar

Antes del timeout, el subagente confirmó con web research:

1. ✅ **Wren AI** sigue siendo el rival más serio (16.5k stars, weekly releases)
2. ✅ **Metabase Metabot AI** confirmado, NL→SQL fuerte pero NO genera dashboards completos
3. ✅ **Briefer** pricing: $129/mes pro, self-hosted enterprise en K8s
4. ✅ **Omni** AI summaries disponible para todos los tiers, no solo enterprise
5. ✅ **Vercel AI SDK v4** tiene `generateObject` con Zod schema nativo (confirmado)
6. ✅ **minimax provider oficial** existe pero es community (`MiniMax-AI/vercel-minimax-ai-provider`)
7. ✅ **Postgres RLS** funciona con `SET LOCAL` pero requiere FORCEROWLEVELSECURITY para table owners
8. ✅ **better-auth** tiene organization plugin + magic links + OAuth, todo soportado
9. ✅ **Cloudflare D1** es SQLite (NO Postgres), confirmado en docs oficiales
10. ✅ **react-pdf** no soporta SVG ni CSS animations (problema para charts)

Toda esta data se usó en el análisis arriba.

---

**Próximo paso recomendado:** Revisar este reporte con Bastián y decidir qué simplificar antes de codear. Sugiero arrancar sesión de trabajo conjunta para tachar 5-8 items de los críticos/altos antes de tocar código.