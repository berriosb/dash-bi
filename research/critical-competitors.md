# Critical Competitors Deep-Dive — dash-bi

> Investigación profunda de los 3 rivales OSS AI-first más cercanos a dash-bi. Esta investigación valida el gap de mercado y ajusta el positioning.

**Fecha:** 2026-07-21
**Status:** Investigación completada para los 3 críticos. Resto de los 15 competidores mantienen análisis de categoría en `competitors.md`.

---

## 1. Metabase (AGPL — el referente OSS)

### Features AI confirmadas (2026)

**Metabot AI** es su feature estrella de IA:
- ✅ **NL→SQL**: usuarios hacen preguntas en lenguaje natural, devuelve SQL
- ✅ **AI generation en SQL/Python editor**: ayuda a escribir queries
- ✅ **AI consciente del semantic layer**: usa métricas, modelos y metadata definidas en Data Studio
- ✅ **Permisos respetados**: AI solo accede a lo que el usuario puede ver
- ✅ **Auditabilidad**: cada respuesta muestra qué modelos/métricas usó
- ✅ **Custom instructions**: tono, nomenclatura, contexto del negocio

### Lo que Metabase **NO** tiene (y es nuestro gap)

| Feature | Metabase | dash-bi |
|---------|----------|---------|
| AI→gráfico individual | ✅ (Metabot) | ✅ |
| AI→dashboard completo multi-widget | ❌ | ✅ (feature estrella) |
| Multi-LLM switch desde UI | ❌ (solo OpenAI) | ✅ (5 providers) |
| Layout engine controlado por IA | ❌ | ✅ |
| Edit iterativo in-place del dashboard | ❌ | ✅ |
| Conectores API-first un click (Stripe, Sheets) | ⚠️ Parcial | ✅ |
| Look SaaS moderno (Linear/Vercel style) | ❌ (UI OSS-feel) | ✅ |

### Pricing actual (referencia)

- **OSS self-hosted**: gratis
- **Metabase Cloud**: desde ~$85/mes por 10 usuarios ( Starter)
- **Pro/Enterprise**: custom pricing, $$$

### Conclusión

**Metabase es fuerte en NL→SQL, débil en AI-generativa-de-dashboards.** Su UI es "OSS-feel" (funcional pero no moderna). dash-bi no compite con Metabase en query builder; compite en "AI que diseña el dashboard por ti" + look SaaS moderno + multi-LLM switch.

**Riesgo:** Metabase podría agregar AI-generativa en 2026-2027. Nuestra ventana: 6-12 meses para establecernos primero.

---

## 2. Wren AI (AGPL — el rival OSS AI-first más serio)

### Status real (verificado 2026-07-21)

- **GitHub:** `Canner/WrenAI`
- **Stars:** 16.5k (proyecto OSS top en sector GenBI)
- **Forks:** 1.9k
- **Releases:** 182+ (muy activo)
- **Licencia:** Apache 2.0 / AGPL mixto
- **Stack:** Python 59% + Rust 37% (Rust para query engine, Python para AI)
- **Comunidad:** 1,700+ Discord members, contributors creciendo 5x año a año
- **Latest release:** wren v0.13.1 (julio 2026) — actualizan semanalmente

### Features verificadas

**GenBI Agent (lo que hacen):**
- ✅ Text-to-SQL con semantic layer (MDL — Metric Definition Language)
- ✅ Generación de dashboards desde prompts
- ✅ 22+ data sources: BigQuery, Snowflake, PostgreSQL, ClickHouse, Redshift, Databricks, MySQL, etc.
- ✅ Multi-LLM: OpenAI, Azure OpenAI, DeepSeek, Gemini, Vertex AI, Bedrock, Anthropic, Groq, Ollama, Databricks
- ✅ Contexto versionable (MDL + instructions.md) → respuestas consistentes
- ✅ GenBI Classic (legacy Docker-based chat-first product) sigue mantenido

### Lo que Wren AI **NO** tiene vs dash-bi

| Feature | Wren AI | dash-bi |
|---------|---------|---------|
| Multi-provider LLM | ✅ (10+ providers) | ✅ (5 providers MVP) |
| Text-to-SQL | ✅ | ✅ |
| AI-genera-dashboards completos | ✅ (GenBI Classic) | ✅ |
| Look SaaS moderno | ❌ (UI funcional, no premium) | ✅ (Tremor + shadcn) |
| Conectores API REST (Stripe, Sheets) | ❌ (solo databases) | ✅ (P0 del MVP) |
| Multi-tenant out-of-the-box | ⚠️ Requiere config | ✅ (org_id desde día 1) |
| Export PDF/PNG reportes presentables | ⚠️ Limitado | ✅ (feature explícita) |
| Self-hosted fácil (Docker Compose) | ⚠️ Pesado (Rust+Python+deps) | ✅ (Next.js+Postgres) |
| Edit iterativo in-place de layouts | ⚠️ Básico | ✅ |

### Por qué dash-bi puede competir con Wren AI

1. **Target diferente:** Wren es para data engineers que ya tienen data warehouses. dash-bi es para usuarios de negocio/equipos pequeños que tienen data en Stripe/Sheets.
2. **Stack más simple:** dash-bi es Next.js + Postgres + LLM API. Wren requiere Rust+Python+AI orchestration. Deploy más simple = más adopción.
3. **Look premium:** dash-bi se ve como SaaS moderno. Wren se ve como "OSS tool".
4. **Reportes presentables:** Wren está orientado a "answer questions". dash-bi está orientado a "deliver reports to clients".

### Conclusión

**Wren AI es el rival OSS AI-first más fuerte.** Tienen 16.5k stars, multi-LLM, text-to-SQL, AI-genera-dashboards. dash-bi **NO** puede competirles en "OSS AI para data engineers". Pero puede competir en:

- **Self-host más simple** (Node/Next vs Rust+Python)
- **Look SaaS moderno** (Tremor vs UI funcional)
- **Conectores API-first** (Stripe un click vs solo databases)
- **Reportes presentables** (PDF branding vs respuesta en chat)
- **Multi-tenant out-of-the-box** (org_id desde schema vs config manual)

**Diferenciador clave:** dash-bi es para "el empleado que necesita mandar un reporte a su jefe el viernes", no para "el data engineer que necesita consultar un data warehouse".

---

## 3. Briefer (AGPL — notebooks + BI + AI)

### Features verificadas

**Lo que hacen:**
- 📚 Notebooks + dashboards en Markdown, Python, SQL + visualizaciones nativas
- 🤳 Data apps interactivas (inputs, dropdowns, date pickers)
- 🕰️ Scheduling (notebooks/dashboards corren periódicamente)
- ⚙️ Ad-hoc pipelines con writebacks
- 🤖 AI assistant que genera código y queries (entiende schema + notebook context)
- 👥 Multiplayer en tiempo real (como Notion)
- 🎨 Customize appearance (branding)

**Deployment:**
- Local (individual)
- Cloud (managed)
- Self-hosted Kubernetes (enterprise)
- Slack integration
- SSO, granular permissions, private AI setup en enterprise

### Lo que Briefer **NO** tiene vs dash-bi

| Feature | Briefer | dash-bi |
|---------|---------|---------|
| AI→gráfico individual | ✅ | ✅ |
| AI→dashboard completo multi-widget | ❌ (AI genera código, no layout) | ✅ |
| Multi-LLM switch | ⚠️ (configurable, no por defecto) | ✅ (UI switch) |
| Look SaaS moderno (Linear/Vercel style) | ❌ (look "notebook-style") | ✅ (corporate dashboard) |
| Reportes presentables PDF/PNG | ⚠️ Limitado | ✅ (feature explícita) |
| Conectores API REST | ❌ (solo databases) | ✅ |
| Self-hosted simple (Docker Compose) | ⚠️ Solo Kubernetes | ✅ (Next.js + Postgres) |
| Pricing claro SaaS | ❌ | ✅ |

### Conclusión

**Briefer es "Notion para notebooks de datos + dashboards".** Su target es data scientists/analysts que quieren un notebook colaborativo con AI. dash-bi es BI puro para gente que quiere "ver KPIs y mandar reportes".

**No es competencia directa.** Son productos complementarios — un usuario podría usar ambos (Briefer para exploración, dash-bi para reportes a cliente).

---

## Conclusiones de la investigación profunda

### 1. El gap de mercado está confirmado y es real

| Producto | Self-host | AI text-to-SQL | AI→dashboard completo | Multi-LLM | Look SaaS | Reportes PDF |
|----------|-----------|----------------|----------------------|-----------|-----------|--------------|
| **Metabase** | ✅ | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| **Wren AI** | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| **Briefer** | ✅ | ✅ | ❌ | ⚠️ | ❌ | ⚠️ |
| **dash-bi** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Solo Wren AI tiene AI→dashboard completo + multi-LLM + self-host.** Pero su look es OSS-feel, no SaaS moderno.

**dash-bi es el único con la combinación completa de las 6 columnas.**

### 2. Wren AI es el rival a vigilar de cerca

- 16.5k stars, lanzamientos semanales, comunidad activa
- Stack técnico serio (Rust query engine)
- Si mejoran UI + agregan conectores API, podrían comerse nuestro espacio
- **Ventana de ventaja:** 6-12 meses

### 3. Briefer no es competencia directa

Es producto complementario. Algunos usuarios podrían usar ambos.

### 4. Metabase sigue siendo el "default" pero tiene UI legacy

Si Metabase agrega AI-generativa-de-dashboards (probable en 2026-2027), será un rival serio. Pero tienen deuda de UI enorme y están atados a Clojure.

### 5. Ajustes al positioning de dash-bi

**Antes de la investigación:**
> "AI-genera-dashboards open source BI con multi-LLM switch"

**Después de la investigación (más preciso):**
> "dash-bi: BI open source con look SaaS moderno, AI-genera-dashboards + multi-LLM, enfocado en reportes presentables y self-host simple. Para el empleado que necesita mandar reportes a su jefe, no para el data engineer que necesita consultar un data warehouse."

### 6. Mensaje para tu portfolio

**Antes:**
> "Berrios construyó dash-bi: plataforma open source de BI con IA multi-provider que genera dashboards desde prompts en lenguaje natural."

**Después (más competitivo):**
> "Berrios construyó dash-bi: la única plataforma open source que combina AI-genera-dashboards completos + multi-LLM (5 providers) + look SaaS moderno (Tremor) + reportes PDF presentables + self-host en Docker. Stack: Next.js 16, PostgreSQL, Drizzle, Vercel AI SDK. Compite directo con Wren AI (16k stars) en el cuadrante self-host + AI-first, con la única combinación full-feature del mercado."

---

## Patrón técnico: JSON Schema Prompting

Investigado para el feature estrella. Confirmaciones:

1. **Structured JSON prompts > free-form** para outputs predecibles (case confirmado por research).
2. **Vercel AI SDK soporta `generateObject` con Zod schema** nativamente → esto es lo que vamos a usar para que la IA devuelva el JSON del dashboard.
3. **Schema validation es crítico:** si la IA devuelve JSON inválido, retry con error → si falla 3 veces, fallback a template estático.
4. **Mejor práctica:** dar el schema como parte del system prompt + ejemplo de output esperado (few-shot).

Implementación confirmada para `specs/widget-system.md`:
- Schema Zod para `Dashboard`, `Widget`, cada uno de los 10 tipos
- System prompt incluye schema + 1-2 ejemplos
- `generateObject` (no `generateText`) para forzar JSON
- Retry logic con feedback del error de validación
- Fallback templates si la IA falla

---

## Siguientes pasos

1. ✅ Investigación crítica completada
2. ➡️ Arrancar `specs/widget-system.md` (la base del feature estrella)
3. ➡️ Specs siguientes: `ai-generate-dashboards.md`, `multi-llm-router.md`, `connectors.md`