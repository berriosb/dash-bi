# Competitor Analysis — dash-bi

> Mapeo detallado de los 18 productos identificados como competencia directa o adyacente.

**Fecha:** 2026-07-21

---

## Categoría 1: OSS BI Tradicionales (los rivales maduros)

### Metabase
- **URL:** https://www.metabase.com
- **Licencia:** AGPL (core), proprietary cloud
- **Stack:** Clojure + React
- **Fortalezas:** Madurez, comunidad enorme, query builder visual, AI chat básico, 25+ datasources
- **Debilidades:** Sin AI generativa de dashboards, sin multi-LLM switch, UI "OSS-feel"
- **Amenaza para dash-bi:** Alta — es el referente. Pero NO tiene AI-genera-dashboards, ese es nuestro gap.

### Apache Superset
- **URL:** https://superset.apache.org
- **Licencia:** Apache 2.0
- **Stack:** Python (Flask) + React
- **Fortalezas:** Enterprise-grade, muy customizable, viz compleja, SQL Lab
- **Debilidades:** Setup complejo, requiere data eng, UX pesada, AI muy básica
- **Amenaza para dash-bi:** Media — más para data engineers, nuestro target es no-técnicos.

### Lightdash
- **URL:** https://www.lightdash.com
- **Licencia:** MIT
- **Stack:** TypeScript + React + dbt
- **Fortalezas:** dbt-native, look moderno, OSS friendly, fácil setup
- **Debilidades:** Requiere dbt, sin AI generativa, sin multi-LLM
- **Amenaza para dash-bi:** Media — comparte el look moderno. Pero atado a dbt.

### Helical Insight
- **URL:** https://www.helicalinsight.com
- **Licencia:** Community Edition (GPL)
- **Stack:** Java/Spring + JS
- **Fortalezas:** Multi-tenant, embebible, self-host, white-label
- **Debilidades:** UI legacy, sin AI, comunidad chica
- **Amenaza para dash-bi:** Baja — UI obsoleta, sin AI.

### LinceBI
- **URL:** https://lincetech.dev
- **Licencia:** OSS
- **Stack:** PHP/Java
- **Fortalezas:** Español, PYMEs hispanohablantes
- **Debilidades:** Visual legacy, sin AI, comunidad chica
- **Amenaza para dash-bi:** Baja — target similar (PYMEs), pero差距 tecnológico grande.

### Blazer
- **URL:** https://github.com/ankane/blazer
- **Licencia:** MIT
- **Stack:** Ruby on Rails
- **Fortalezas:** Minimalista, simple, SQL-only
- **Debilidades:** Solo SQL, sin viz avanzada, sin AI, requiere Ruby
- **Amenaza para dash-bi:** Baja — más para devs que quieren BI simple.

### Redash
- **URL:** https://redash.io
- **Licencia:** BSD
- **Stack:** Python (Flask) + AngularJS (legacy)
- **Fortalezas:** SQL-first, ligero, muchas datasources, alertas
- **Debilidades:** UI legacy AngularJS, sin AI, mantenimiento lento
- **Amenaza para dash-bi:** Baja — UI obsoleta, sin AI.

### Grafana
- **URL:** https://grafana.com
- **Licencia:** AGPL
- **Stack:** Go + React
- **Fortalezas:** Dashboard engine maduro, monitoring + BI, plugins
- **Debilidades:** Orientado a monitoring (time-series), BI es secundario, sin AI nativa
- **Amenaza para dash-bi:** Baja-Media — si el usuario quiere monitoring+BI. Pero nuestro target es BI puro.

### OpenBB
- **URL:** https://openbb.co
- **Licencia:** Custom (open core)
- **Stack:** Python + React
- **Fortalezas:** Datos financieros open source, terminal-style UI
- **Debilidades:** Nicho (finanzas), sin BI general, sin multi-tenant
- **Amenaza para dash-bi:** Baja — nicho diferente.

### BIRT (Eclipse)
- **URL:** https://eclipse.github.io/birt/
- **Licencia:** EPL
- **Stack:** Java + Eclipse
- **Fortalezas:** Reporting tradicional, embedding
- **Debilidades:** Legacy, sin AI, setup Java/Eclipse
- **Amenaza para dash-bi:** Nula — obsoleto.

### QueryTree
- **URL:** https://querytree.com
- **Licencia:** SaaS (freemium)
- **Fortalezas:** Query builder visual para no-técnicos
- **Debilidades:** SaaS only, sin AI, sin self-host
- **Amenaza para dash-bi:** Baja — SaaS, sin self-host.

## Categoría 2: OSS AI-first (los más cercanos en visión)

### Briefer
- **URL:** https://www.briefer.cloud
- **Licencia:** AGPL
- **Stack:** Python + React
- **Fortalezas:** Notebooks + BI + AI chat, OSS
- **Debilidades:** Chat → chart individual, no compone dashboards completos, AI solo OpenAI
- **Amenaza para dash-bi:** Media — comparte visión AI. Diferenciador: dash-bi compone dashboards completos + multi-LLM.

### Wren AI
- **URL:** https://www.getwren.ai
- **Licencia:** AGPL
- **Stack:** Python + Next.js
- **Fortalezas:** Semantic layer + AI, OSS, generación de SQL
- **Debilidades:** SQL-focused, no layout engine propio, UI mejorable
- **Amenaza para dash-bi:** Media — OSS AI-first pero más SQL que dashboard.

### Evidence
- **URL:** https://evidence.dev
- **Licencia:** MIT
- **Stack:** TypeScript + Svelte
- **Fortalezas:** Markdown-first BI, código como dashboard, moderno
- **Debilidades:** Requiere código, no es GUI, sin AI generativa
- **Amenaza para dash-bi:** Baja — para devs que quieren BI-as-code.

## Categoría 3: Herramientas estadísticas

### EDA (Exploratory Data Analysis)
- **Categoría:** Metodología + herramientas (pandas-profiling, sweetviz, etc.)
- **Amenaza para dash-bi:** Nula — diferente uso.

## Categoría 4: SaaS con free tier

### Looker Studio
- **URL:** https://lookerstudio.google.com
- **Licencia:** Free
- **Fortalezas:** Free, Google ecosystem, fácil setup
- **Debilidades:** Solo Google datasources nativas, sin self-host, sin AI
- **Amenaza para dash-bi:** Media — compite por usuarios no-técnicos. Diferenciador: dash-bi es self-host + multi-datasource real.

## Categoría 5: Frameworks BI / app builders

### Streamlit
- **URL:** https://streamlit.io
- **Licencia:** Apache 2.0
- **Fortalezas:** Python framework para data apps, muy popular
- **Debilidades:** No es BI, requiere programar, sin multi-tenant nativo
- **Amenaza para dash-bi:** Baja — Streamlit es para devs, dash-bi es BI para no-técnicos.

## Categoría 6: SaaS pagos (referencia de mercado)

### Power BI
- **Amenaza:** Define el mercado. dash-bi es "Power BI open source, moderno, con AI".

### Omni / ThoughtSpot
- **Amenaza:** AI-first enterprise. Demuestran que el mercado AI-BI existe. Pero $$$.

### Julius AI / Draxlr
- **Amenaza:** NL→chart individual. No dashboards completos. Diferenciador claro para dash-bi.

---

## Matriz de posicionamiento

```
                    Self-host
                       ↑
                       |
        Metabase ●     |     ● Superset
                       |
        Lightdash ●    |     ● Grafana
                       |
        dash-bi ●       |     ● Omni/ThoughtSpot (SaaS)
                       |
   Looker ● Wren ●    |     ● Power BI (SaaS)
                       |
        Briefer ●      |     ● Julius/Draxlr (SaaS)
                       |
   ────────────────────┼────────────────────→ AI-first
                       |
```

**dash-bi se posiciona en:** cuadrante self-host + AI-first, donde solo Metabase (sin AI generativa) y Wren/Briefer (sin dashboards completos) están cerca.

## Conclusiones estratégicas

1. **Gap claro:** Nadie combina OSS + self-host + AI generativa de dashboards completos + multi-LLM + look SaaS moderno.
2. **Riesgo principal:** Metabase podría agregar AI generativa. Pero ya tienen 10 años de deuda UI y están atados a Clojure.
3. **Velocidad importa:** Salir con MVP en 4 semanas antes que Metabase reaccione.
4. **Posicionamiento de portfolio:** "Berrios construyó dash-bi" en el cuadrante correcto del mapa = entrevista asegurada.