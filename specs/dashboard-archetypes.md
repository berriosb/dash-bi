# Spec: Dashboard Archetypes

> Sistema que garantiza que cada dashboard generado por la IA sea **visualmente distinto**, no un template repetido con números cambiados. Define 7 patrones atómicos + 8 archetypes compuestos + 4 axes de variación. Combinatoria: ~1.400 dashboards visualmente distintos.

**Status:** Draft v0.1
**Prioridad:** P0 — diferenciador clave de la feature estrella
**Responsable:** codehak
**Depende de:** `widget-system.md`, `ai-generate-dashboards.md`, `manual-editing.md`
**Relacionado:** `layouts-themes.md`

---

## 1. Problema que resolvemos

Si solo decimos "la IA elige los widgets" sin estructura, **todos los dashboards quedan parecidos** (KPI row + 2 charts + tabla). Eso destruye el diferenciador clave de dash-bi: el "look único por dashboard".

**Solución:** patrones atómicos como vocabulario base, archetypes como combinaciones curadas, axes de variación para diversidad combinatoria.

## 2. Principios de diseño

1. **Archetypes son estructura + constraints, no templates pixel-perfect.** Solo definen dónde van los widgets (filas/columnas relativas), cuántos, y qué tipos. La IA decide cuál es el "hero", qué color accent, qué labels.
2. **Variación por defecto.** Si dos prompts son similares pero no idénticos, el archetype DEBE ser distinto. La IA no debe repetir el mismo pattern sin que se lo pida.
3. **Componibilidad.** Los patrones atómicos se combinan como Lego — si el prompt sugiere algo nuevo (ej. "health check de servicios"), la IA inventa una composición nueva pero **usando solo patrones atómicos del vocabulario**.
4. **Editable.** Después de generar, el usuario entra en Edit mode (`manual-editing.md`) y puede mover/agregar/quitar widgets libremente. Los archetypes son solo punto de partida.

---

## 3. Vocabulario de patrones atómicos

7 patrones mínimos. La IA solo puede componer usando estos.

| ID | Patrón | Descripción | Slots (12-col grid) | Widgets permitidos |
|---|---|---|---|---|
| `hero-metric` | 1 número gigante | KPI dimensional que ocupa 6 col, alto | 1 KPI en col 1-6 | solo `kpi` |
| `kpi-row` | Fila de mini-KPIs | 3-4 KPIs en una fila | 3-4 KPIs en cols 1-12 | solo `kpi` |
| `chart-spotlight` | 1 chart grande | Chart full-width con leyenda grande | 1 chart en cols 1-12 | line/bar/area/scatter/pie |
| `comparison-grid` | 2 charts side-by-side | 2 charts chicos comparando dimensiones | 2 charts en cols 1-6 y 7-12 | line/bar/area (mismo tipo) |
| `data-table` | Tabla con datos crudos | Tabla completa con paginación | 1 tabla en cols 1-12 | solo `table` |
| `timeline` | Serie temporal | 1 line chart con eje X tiempo | 1 line/area chart en cols 1-12 | line/area |
| `breakdown-list` | Distribución | Pie/bar de proporciones | 1 chart en cols 1-12 | pie/bar (sorted) |

## 4. Archetypes compuestos (curados)

Combinaciones de patrones atómicos probadas. Cada uno tiene un **selector** (keywords que lo disparan), **constraints** (límites), y **axes** (variación).

### 4.1 `kpi-grid` — Default analytics

- **Selector:** "dashboard", "métricas generales", "overview", "vista general", sin contexto
- **Composición:** `kpi-row` (6 KPIs) + `chart-spotlight` (1 line)
- **Constraints:** 6-8 widgets totales, todos KPI pequeño excepto 1 chart grande
- **Mejor para:** Stripe básico, Postgres genérico, primer dashboard del usuario
- **Variaciones típicas:**
  - density `balanced`, theme `moderno-saas`
  - time window `last_30_days` o `last_6_months`

### 4.2 `hero-focus` — Métrica destacada + contexto

- **Selector:** "destaca X", "foco en X", "lo más importante", "hero", "único número"
- **Composición:** `hero-metric` + `kpi-row` (3 KPIs) + `chart-spotlight`
- **Constraints:** exactamente 1 hero, 3 KPI mini, 1 chart grande
- **Mejor para:** Métrica única que el usuario ya sabe cuál es (revenue, MAU, conversion)
- **Variaciones típicas:**
  - density `spacious` para ejecutivos
  - comparativo `previous_period` debajo del hero

### 4.3 `cohort-matrix` — Análisis de cohortes

- **Selector:** "cohorte", "retention", "LTV por cohorte", "engagement en el tiempo"
- **Composición:** `hero-metric` (LTV última cohorte) + `timeline` (retención) + `breakdown-list` (distribución por canal) + `data-table` (matriz cohortes)
- **Constraints:** 1 hero, 1 line/area, 1 pie/bar, 1 tabla
- **Mejor para:** Postgres con eventos, análisis de retención
- **Variaciones típicas:**
  - density `dense`, 15-30 cohortes en la tabla
  - time window `last_6_months` o `last_year`

### 4.4 `sales-pipeline` — Funnel comercial

- **Selector:** "pipeline", "embudo de ventas", "leads", "deals", "oportunidades"
- **Composición:** `kpi-row` (4: pipeline value, qualified, negotiation, won) + `comparison-grid` (2 charts: stage progression + time-to-close) + `data-table` (top N deals)
- **Constraints:** mínimo 2 charts comparativos, 1 tabla al final
- **Mejor para:** Pipelines CRM, Salesforce (Fase 2), Close.io (Fase 2), Postgres custom
- **Variaciones típicas:**
  - density `balanced`
  - comparativo `previous_quarter` en header del pipeline

### 4.5 `executive-summary` — Vista para CEO/jefe

- **Selector:** "ejecutivo", "resumen", "weekly report", "para el jefe", "1 página", "máster"
- **Composición:** `hero-metric` (1 KPI gigante) + `chart-spotlight` (1 chart grande, gradiente) + `data-table` (tabla compacta 5 filas)
- **Constraints:** máximo 3 widgets, 1 hero, 1 chart, 1 tabla pequeña
- **Mejor para:** Cualquier data source con 1 métrica principal
- **Variaciones típicas:**
  - density `spacious` forzado
  - theme `corporate` preferido
  - sin comparativos visuales, copy explícito "vs trimestre anterior"

### 4.6 `operations-live` — Monitoreo en tiempo real

- **Selector:** "operaciones", "live", "monitoreo", "status", "salud", "uptime"
- **Composición:** `kpi-row` (4 con delta live) + `timeline` (con refresh indicator) + `comparison-grid` (2 charts: now vs SLA)
- **Constraints:** 4+ KPIs con delta, 1 timeline con frecuencia corta (5min, 1h)
- **Mejor para:** Sistemas internos, monitoring de servicios
- **Variaciones típicas:**
  - refresh `live` (no cache TTL) — ver `query-engine.md` §10
  - density `balanced`
  - theme `corporate`

### 4.7 `finance-report` — Reporte contable/financiero

- **Selector:** "reporte financiero", "P&L", "ingresos vs gastos", "balance", "finanzas", "trimestral"
- **Composición:** `kpi-row` (4-6 con formato currency) + `breakdown-list` (distribución por categoría) + `data-table` (detalle de líneas)
- **Constraints:** todos los números en `currency`, density `dense`
- **Mejor para:** Stripe (revenue breakdown), Postgres (financial data)
- **Variaciones típicas:**
  - theme `corporate` forzado
  - density `dense` forzado
  - comparativo `previous_quarter` o `last_year`

### 4.8 `growth-metrics` — Métricas de growth/marketing

- **Selector:** "growth", "marketing", "funnel de adquisición", "conversión", "CAC", "LTV", "engagement"
- **Composición:** `comparison-grid` (2 charts: acquisition channels + retention curves) + `comparison-grid` (2 charts: cohorts + LTV distribution) + `kpi-row` (3: CAC, LTV, ratio)
- **Constraints:** mínimo 4 charts, 3 KPIs al final
- **Mejor para:** Stripe + eventos, Google Analytics-style data
- **Variaciones típicas:**
  - density `balanced`
  - theme `moderno-saas`
  - time window `last_quarter` o `last_6_months`

---

## 5. Axes de variación

Cada archetype tiene 4 dimensions donde variar:

### 5.1 Density (densidad visual)

```typescript
type Density = 'spacious' | 'balanced' | 'dense';

const DENSITY_RULES = {
  spacious: { cardPadding: '32px', cardGap: '24px', maxWidgets: 6 },
  balanced: { cardPadding: '24px', cardGap: '16px', maxWidgets: 12 },
  dense:    { cardPadding: '16px', cardGap: '12px', maxWidgets: 12 },
};
```

### 5.2 Theme accent (color dominante)

```typescript
type ThemeAccent = 'default' | 'accent' | 'muted';
// default: primary color (e.g. indigo en moderno-saas)
// accent: el color accent (pink en moderno-saas, cyan en corporate)
// muted: grey/slate (más sobrio)
```

La IA escoge cuál destacar visualmente (ej. los números positivos van en success siempre, pero el "hero" puede ir en accent para llamar la atención).

### 5.3 Time window (eje X de las series temporales)

```typescript
type TimeWindow = 'last_24h' | 'last_7d' | 'last_30d' | 'last_90d' | 'last_6mo' | 'last_year' | 'all_time';
```

El usuario puede pedir una específica; si no la pide, la IA elige según el data source (Stripe tiende a meses, monitoring a minutos).

### 5.4 Comparativo

```typescript
type Comparativo = 'none' | 'previous_period' | 'previous_month' | 'previous_quarter' | 'previous_year' | 'last_year_same_week';
```

Para KPIs (delta %) y charts (línea secundaria punteada).

---

## 6. Schema del Dashboard

```typescript
// lib/widgets/dashboard.ts

export type ArchetypeId =
  | 'kpi-grid'
  | 'hero-focus'
  | 'cohort-matrix'
  | 'sales-pipeline'
  | 'executive-summary'
  | 'operations-live'
  | 'finance-report'
  | 'growth-metrics'
  | 'custom';   // cuando la IA compone su propia combinación

export type ThemeId = 'moderno-saas' | 'corporate';
export type Density = 'spacious' | 'balanced' | 'dense';
export type ThemeAccent = 'default' | 'accent' | 'muted';
export type TimeWindow = 'last_24h' | 'last_7d' | 'last_30d' | 'last_90d' | 'last_6mo' | 'last_year' | 'all_time';
export type Comparativo = 'none' | 'previous_period' | 'previous_month' | 'previous_quarter' | 'previous_year' | 'last_year_same_week';

export type Dashboard = {
  title: string;
  description?: string;
  theme: ThemeId;
  widgets: Widget[];

  // v0.3: metadata de archetype + axes (opcional, auto-generado por AI)
  archetype?: ArchetypeId;
  archetypeVariant?: {
    density: Density;
    accent: ThemeAccent;
    timeWindow: TimeWindow;
    comparativo: Comparativo;
  };
};
```

`archetype` es opcional pero cuando la IA genera el dashboard, **siempre lo setea** (con `custom` cuando compone libremente). Editable desde UI (dropdown en el toolbar).

## 7. Reglas del system prompt para la IA

```typescript
export const ARCHETYPE_SYSTEM_PROMPT_RULES = `
# DASHBOARD ARCHETYPES

Cuando generes un dashboard, debes elegir UN archetype o componer uno custom 
usando solo los 7 patrones atómicos permitidos.

## Archetypes disponibles
- kpi-grid: KPI-row (6) + chart-spotlight
- hero-focus: hero-metric + KPI-row (3) + chart-spotlight
- cohort-matrix: hero-metric + timeline + breakdown-list + data-table
- sales-pipeline: KPI-row (4) + comparison-grid + data-table
- executive-summary: hero-metric + chart-spotlight + data-table (compacta)
- operations-live: KPI-row (4 con delta live) + timeline + comparison-grid
- finance-report: KPI-row + breakdown-list + data-table (densidad dense)
- growth-metrics: comparison-grid + comparison-grid + KPI-row (3)

## Patrones atómicos permitidos
- hero-metric: 1 KPI, 6 col, alto
- kpi-row: 3-6 KPIs en una fila
- chart-spotlight: 1 chart, full-width
- comparison-grid: 2 charts side-by-side
- data-table: 1 tabla
- timeline: 1 line/area con eje tiempo
- breakdown-list: 1 pie/bar de proporciones

## Selector automático
Lee keywords del prompt y elige el archetype más cercano:
- "ejecutivo", "resumen", "jefe", "1 página"  → executive-summary
- "pipeline", "embudo", "leads", "deals"      → sales-pipeline
- "cohorte", "retention", "LTV cohorte"       → cohort-matrix
- "monitoreo", "live", "status", "uptime"     → operations-live
- "reporte", "finanzas", "P&L", "trimestral"   → finance-report
- "growth", "marketing", "adquisición"        → growth-metrics
- "destaca X", "foco en X", "hero X"          → hero-focus
- "general", "overview", sin contexto         → kpi-grid (default)

## VARIEDAD (CRÍTICO)
- Si dos prompts son similares pero no idénticos → archetype DISTINTO
- Si el usuario no especifica density → varía entre spacious/balanced/dense
- Si no especifica theme accent → varía entre default/accent/muted
- En generaciones consecutivas del mismo usuario → no repitas la misma 
  combinación archetype + density + accent a menos que se pida
- Archetypes "raros" del selector automático (operations-live, finance-report) 
  vale la pena sugerir proactivamente aunque el prompt no los pida

## CUSTOM archetype
Si ningún archetype fittea perfectamente, puedes componer uno custom marcando 
"archetype": "custom" en el JSON. Pero solo usando los 7 patrones atómicos.

## Edits manuales
El usuario va a entrar a edit mode después. Puedes asumir:
- Va a mover widgets (cambiar position)
- Va a eliminar widgets que sobren
- Va a agregar widgets nuevos (patrones atómicos solamente)
- Va a cambiar el theme pero NO el archetype (eso lo elige la IA al regenerar)
`;
```

## 8. Constraint validator

Para evitar que la IA rompa un archetype, el `DashboardSchema` (ver `widget-system.md` §6) valida:

```typescript
import type { Position } from '@/lib/widgets/types';

// Widget system imports are resolved at implementation time; this is the validator reference.

function validateArchetype(dashboard: Dashboard): ValidationError[] {
  const archetype = dashboard.archetype ?? 'custom';
  const constraints = ARCHETYPE_CONSTRAINTS[archetype];

  // 1. Total widgets
  if (dashboard.widgets.length > constraints.maxWidgets) {
    return [{ kind: 'too_many_widgets', expected: constraints.maxWidgets, got: dashboard.widgets.length }];
  }

  // 2. Tipo de widget por slot
  for (const slot of constraints.slots) {
    const widgetsInSlot = dashboard.widgets.filter(w =>
      w.position.col >= slot.col && w.position.col + w.position.colSpan <= slot.col + slot.colSpan
    );
    for (const w of widgetsInSlot) {
      if (!slot.allowedTypes.includes(w.type)) {
        return [{ kind: 'forbidden_widget_type', slot: slot.id, type: w.type, allowed: slot.allowedTypes }];
      }
    }
  }

  // 3. Overlap check (ningún widget puede ocupar la misma celda que otro)
  for (let i = 0; i < dashboard.widgets.length; i++) {
    for (let j = i + 1; j < dashboard.widgets.length; j++) {
      const a = dashboard.widgets[i].position;
      const b = dashboard.widgets[j].position;
      if (widgetsOverlap(a, b)) {
        return [{
          kind: 'widgets_overlap',
          widgetA: dashboard.widgets[i].id,
          widgetB: dashboard.widgets[j].id,
          message: `Widgets ${dashboard.widgets[i].id} and ${dashboard.widgets[j].id} overlap`,
        }];
      }
    }
  }

  // 4. Bounds check (widgets deben estar dentro del grid 12-col)
  for (const w of dashboard.widgets) {
    if (w.position.col < 1 || w.position.col > 12) {
      return [{ kind: 'widget_out_of_bounds', widget: w.id, axis: 'col', value: w.position.col }];
    }
    if (w.position.col + w.position.colSpan - 1 > 12) {
      return [{ kind: 'widget_out_of_bounds', widget: w.id, axis: 'colSpan', value: w.position.colSpan }];
    }
    if (w.position.row < 1) {
      return [{ kind: 'widget_out_of_bounds', widget: w.id, axis: 'row', value: w.position.row }];
    }
    if (w.position.rowSpan > 6) {
      return [{ kind: 'widget_out_of_bounds', widget: w.id, axis: 'rowSpan', value: w.position.rowSpan }];
    }
  }

  return [];
}

/**
 * Detecta si dos posiciones se solapan en el grid 12-col.
 * Dos widgets se solapan si sus rangos [col, col+colSpan) × [row, row+rowSpan)
 * tienen intersección no-vacía.
 */
function widgetsOverlap(a: Position, b: Position): boolean {
  const aEndCol = a.col + a.colSpan;
  const aEndRow = a.row + a.rowSpan;
  const bEndCol = b.col + b.colSpan;
  const bEndRow = b.row + b.rowSpan;
  return !(aEndCol <= b.col || bEndCol <= a.col || aEndRow <= b.row || bEndRow <= a.row);
}

const ARCHETYPE_CONSTRAINTS: Record<ArchetypeId, {
  maxWidgets: number;
  slots: Array<{ id: string; col: number; colSpan: number; allowedTypes: WidgetType[] }>;
}> = {
  'kpi-grid': {
    maxWidgets: 8,
    slots: [
      { id: 'kpi-row', col: 1, colSpan: 12, allowedTypes: ['kpi'] },
      { id: 'chart', col: 1, colSpan: 12, allowedTypes: ['line-chart', 'bar-chart', 'area-chart', 'pie-chart', 'scatter'] },
    ],
  },
  'hero-focus': { /* … */ },
  // …
  'custom': { maxWidgets: 12, slots: [] },  // sin constraints
};
```

## 9. Manual editing integración

Cuando un usuario entra a edit mode después de generar (ver `manual-editing.md`):

1. **Arquetipo se preserva en metadata.** El `Dashboard.archetype` queda en el JSON para referencia (no se elimina al editar manualmente).
2. **Cambios que rompen el archetype son libres.** Si el user saca widgets del slot del archetype, no rompemos nada — el validator no se vuelve a correr al editar manualmente.
3. **"Regenerar" usa el prompt actualizado, no el archetype actual.** Si el user regenera un dashboard después de editarlo, la IA elige un archetype nuevo basado en el prompt (no se "ancla" al archetype previo).
4. **Dropdown de archetype en toolbar.** El usuario puede cambiar el archetype manualmente desde la UI (esto regenera la disposición automáticamente, manteniendo los widgets que ya eligió).

```tsx
// components/dashboard/ArchetypePicker.tsx (edit mode)

export function ArchetypePicker({ dashboard, onChange }) {
  return (
    <Select value={dashboard.archetype} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Elegir archetype" />
      </SelectTrigger>
      <SelectContent>
        {ARCHETYPES.map(a => (
          <SelectItem key={a.id} value={a.id}>
            {a.name} — {a.tagline}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

## 10. UX: cómo se siente desde el usuario

### 10.1 Generar dashboard

```
Prompt: "Cómo van las ventas"
            ↓
Chat muestra: "Usando archetype 'kpi-grid' con density balanced, tema 
moderno-saas. Si querés otro estilo, decime: 'más ejecutivo', 'foco en 
revenue', 'ejecutivo weekly report'."
            ↓
Dashboard renderizado (no aparece un modal de archetype — la IA lo hace 
inline)
```

### 10.2 Pedir variantes

```
Prompt: "Mostrame 3 variaciones distintas del primer prompt"
            ↓
IA genera 3 dashboards consecutivos con archetypes distintos:
  1. kpi-grid (default)
  2. hero-focus (con revenue como hero)
  3. cohort-matrix (revenue mensual con cohortes trimestrales)
```

### 10.3 Cambiar archetype después

```
Edit mode → toolbar dropdown "Archetype: kpi-grid ▾"
            ↓
User selecciona "executive-summary"
            ↓
Dashboard se reorganiza: 1 KPI mega + 1 chart + tabla 5 filas 
(widget data preservado si es posible)
```

## 11. Acceptance criteria

- [ ] 8 archetypes definidos con constraints validados por Zod
- [ ] 7 patrones atómicos como vocabulario cerrado
- [ ] `Dashboard.archetype` y `archetypeVariant` en el schema
- [ ] System prompt incluye las reglas de variedad
- [ ] Validator detecta violaciones (too_many_widgets, forbidden_widget_type)
- [ ] Edit mode permite cambiar el archetype desde un dropdown
- [ ] Edit mode permite edición libre que rompe el archetype (no se valida después)
- [ ] La IA genera 3 variantes distintas para el mismo prompt básico
- [ ] Cada archetype tiene un ejemplo renderizable (visual mockup)
- [ ] Custom archetype funciona (composición libre con los 7 patrones)

## 12. Out of scope (MVP)

- ❌ Templates pre-hechos por industria (Fase 2 — pero los archetypes son el primer paso)
- ❌ Marketplace de archetypes custom de la comunidad (Fase 3)
- ❌ Editor visual de archetypes (TypeScript-only)
- ❌ Detección automática de archetype desde prompt sin selector keywords
- ❌ Animaciones de transición entre archetypes

## 13. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Los 8 archetypes no cubren todos los casos | Custom archetype: la IA compone con patrones atómicos |
| Validator demasiado estricto | Custom archetype + manual edit lo bypassea |
| IA repite siempre el mismo archetype | Regla explícita de variedad + tracking de últimos 3 usados |
| Cambiar archetype pierde widgets del usuario | Preservar widget data al reasignar slots (best-effort match por query similar) |
| Demasiadas opciones confunden al usuario | Default siempre kpi-grid; advanced dropdown oculto en "more options" |

## 14. Roadmap (Fase 2+)

- **Fase 2:** 6-8 archetypes más (mobile-first, geographic, AB-test, server-metrics, etc.)
- **Fase 2:** Industry templates (e-commerce, SaaS, finance, marketing) que pre-setean archetype + theme + density + sugerencia de data sources
- **Fase 3:** Marketplace comunitario de archetypes custom
- **Fase 3:** Editor visual para crear archetypes nuevos sin código

## 15. Especificaciones relacionadas

- `widget-system.md` — schema del Dashboard extendido con archetype
- `ai-generate-dashboards.md` — system prompt incluye las reglas de archetypes
- `manual-editing.md` — edit mode permite cambiar archetype + edición libre
- `layouts-themes.md` — theme + accent que los axes combinan
- `query-engine.md` — refresh strategy de los widgets por archetype (operations-live usa live, kpi-grid usa cached-ttl)
