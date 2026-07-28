# Spec: Widget System

> Sistema de widgets que la IA compone en dashboards. Base del feature estrella AI-genera-dashboards.

**Status:** Draft v0.4 (sync 2026-07-21 — design diversity)
**Prioridad:** P0 — bloquea el feature estrella
**Responsable:** codehak

---

## Cambios respecto a v0.3

**Sync v0.4 — design diversity:**
- ✅ Nueva sección §3.0 con tipo `Dashboard` extendido: `archetype` + `archetypeVariant` opcionales
- ✅ Referencia a `specs/dashboard-archetypes.md` (vocabulario de patrones + 8 archetypes curados)
- ✅ El validator de Zod acepta el nuevo shape sin romper compat con dashboards viejos

**Sync v0.3 — alinear con decisiones congeladas:**
- ❌ Removidos: `react-grid-layout` de dependencias (drag-drop usa `dnd-kit`, ver `manual-editing.md`)
- ❌ Removidos schemas de `HeatmapWidget`, `FunnelWidget`, `StackedBarWidget` (solo quedan referencias a su eliminación)
- ❌ Removidos union types de `DataSource.kind: 'inline'` y `'computed'`. Solo `'query'`
- ❌ Removidas referencias a themes `executive` y `analyst` (ver `layouts-themes.md` para los 2 themes MVP)

**Decisiones aplicadas (post-auditoría 2026-07-21):**
- ❌ Eliminados: `heatmap`, `funnel`, `stacked-bar` (casos de uso nicho, +2-3 semanas de render PDF).
- ✅ Quedan **7 widgets**: kpi, line-chart, bar-chart, pie-chart, area-chart, scatter, table.
- ❌ Eliminado: `DataSource.kind: 'inline'`. Ahora SOLO `query`.
- ❌ Eliminado: `DataSource.kind: 'computed'`. Era roadmap, nunca se usó.

## 1. Objetivo

Definir un sistema de widgets donde:

1. **Cada widget es declarativo** — recibe JSON config, no HTML
2. **Hay 7 tipos limitados** — la IA solo puede usar estos, no improvisa HTML
3. **Son componibles** — múltiples widgets forman un dashboard
4. **Son themes-aware** — colors/fonts/spacing vienen del theme activo (moderno-saas o corporate)
5. **Son responsive** — funcionan mobile, tablet, desktop
6. **Son trazables** — el JSON incluye metadata para audit (qué IA lo generó, cuándo, qué data source)

## 2. Tipos de widget (7)

| # | Tipo | Visualización | Data shape típica | Uso común |
|---|------|---------------|-------------------|-----------|
| 1 | `kpi` | Número grande + delta | `{value, delta, deltaType}` | "Revenue hoy: $45,230 (+12%)" |
| 2 | `line-chart` | Serie temporal | `[{date, value}], series[]` | Tendencias en el tiempo |
| 3 | `bar-chart` | Barras verticales/horizontales | `[{label, value}], series[]` | Comparación categorías |
| 4 | `pie-chart` | Sectores circulares | `[{label, value}]` | Distribución partes del todo |
| 5 | `area-chart` | Línea con relleno | `[{date, value}]` | Magnitud + tendencia |
| 6 | `scatter` | Puntos X/Y | `[{x, y}]` | Correlaciones |
| 7 | `table` | Tabla con headers | `[{...rows}], columns[]` | Data cruda, listas |

**Por qué 7 y no 10:** auditoría 2026-07-21 reveló que heatmap/funnel/stacked-bar eran casos de uso nicho (+2-3 semanas de render PDF sin beneficio proporcional). 7 widgets cubren el 95% de dashboards reales.

## 3. Schema JSON (TypeScript + Zod)

### 3.0 Tipo del Dashboard (con archetype)

> **v0.4:** El Dashboard ahora incluye metadata del archetype usado por la IA + los axes de variación. Esto permite variación entre dashboards y respeta ediciones manuales (ver §10 integración edit mode).

```typescript
// lib/widgets/dashboard.ts (re-exportado desde widget-system)

import type { Widget } from './widget-system';

export type ArchetypeId =
  | 'kpi-grid'
  | 'hero-focus'
  | 'cohort-matrix'
  | 'sales-pipeline'
  | 'executive-summary'
  | 'operations-live'
  | 'finance-report'
  | 'growth-metrics'
  | 'custom';

export type Density = 'spacious' | 'balanced' | 'dense';
export type ThemeAccent = 'default' | 'accent' | 'muted';
export type TimeWindow =
  | 'last_24h' | 'last_7d' | 'last_30d' | 'last_90d'
  | 'last_6mo' | 'last_year' | 'all_time';
export type Comparativo =
  | 'none' | 'previous_period' | 'previous_month'
  | 'previous_quarter' | 'previous_year' | 'last_year_same_week';

export type Dashboard = {
  title: string;
  description?: string;
  theme: 'moderno-saas' | 'corporate';
  widgets: Widget[];

  // v0.4: metadata de archetype
  archetype?: ArchetypeId;
  archetypeVariant?: {
    density: Density;
    accent: ThemeAccent;
    timeWindow: TimeWindow;
    comparativo: Comparativo;
  };
  schemaVersion?: number; // default 1
};

/**
 * Migrador de versión de esquema JSON para retrocompatibilidad.
 * Transforma estructuras JSON creadas en versiones anteriores (v0.1-v0.3) al formato actual.
 */
export function migrateDashboardSchema(rawJson: Record<string, any>): Dashboard {
  const version = rawJson.schemaVersion ?? 1;
  const migrated = { ...rawJson };

  if (version < 2) {
    // Garantizar que archetype esté inicializado
    migrated.archetype = migrated.archetype ?? 'custom';
    migrated.theme = ['moderno-saas', 'corporate'].includes(migrated.theme) ? migrated.theme : 'moderno-saas';
    migrated.schemaVersion = 2;
  }
  return migrated as Dashboard;
}
```

> **Importante:** `archetype` y `archetypeVariant` son **opcionales** para mantener back-compat con dashboards anteriores a v0.4. La IA los setea automáticamente; los editados manualmente también (dropdown en toolbar de `manual-editing.md` §9). `migrateDashboardSchema` garantiza que dashboards cargados desde la base de datos se normalicen al formato actual.
>
> Ver `specs/dashboard-archetypes.md` para las definiciones de cada archetype + constraints + integration.

### 3.1 Tipos base

```typescript
// Posición en el grid del dashboard (12-column grid responsive)
type Position = {
  col: number;        // 1-12 (grid columns)
  row: number;        // row index (1-based)
  colSpan: number;    // 1-12 (width in columns)
  rowSpan: number;    // 1-N (height in rows)
};

// Color theme (referencia a variables CSS del theme activo)
type ThemeColor = 
  | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' 
  | 'muted' | 'accent';

// Config común a todos los widgets
type BaseConfig = {
  title?: string;           // opcional, sobre el widget
  subtitle?: string;        // opcional, bajo el title
  showLegend?: boolean;     // default true para charts
  colorScheme?: ThemeColor[]; // paleta de colores
};

// Data source — SIEMPRE query real, nunca inline
type DataSource = {
  kind: 'query';
  dataSourceId: string;                  // referencia al data source conectado
  query: Query;                           // ver connectors.md para shapes
  /**
   * Estrategia de refresh por widget (default: 'cached-ttl' con TTL 60s).
   * Ver `query-engine.md` §10.
   *
   * - `live`: re-ejecuta cada vez que se monta el widget (uso: tablas operativas, monitoring)
   * - `cached-ttl`: usa cache Redis con TTL configurable (default: KPIs/charts)
   * - `manual`: solo re-ejecuta al click "Refresh" (uso: links públicos, dashboards pesados)
   */
  refresh?: {
    mode: 'live' | 'cached-ttl' | 'manual';
    ttlSeconds?: number;   // default 60; ignorado si mode='live' o 'manual'
  };
};
```

### 3.2 Cada widget type

```typescript
// 1. KPI — un número grande con delta opcional
type KPIWidget = {
  type: 'kpi';
  id: string;
  position: Position;
  config: BaseConfig & {
    format?: 'currency' | 'number' | 'percent';
    deltaFormat?: 'currency' | 'number' | 'percent';
    showDelta?: boolean;        // default true
    deltaType?: 'absolute' | 'percent';
    comparisonPeriod?: 'previous' | 'last_year' | 'last_month' | 'last_week';
    icon?: string;              // lucide-react icon name
  };
  data: {
    value: number;
    delta?: number;
    target?: number;
  };
  source: DataSource;
};

// 2. Line chart — serie temporal
type LineChartWidget = {
  type: 'line-chart';
  id: string;
  position: Position;
  config: BaseConfig & {
    xAxis?: 'time' | 'category' | 'number';
    yAxis?: 'linear' | 'log';
    showGrid?: boolean;
    smooth?: boolean;          // curva suavizada
    showPoints?: boolean;
  };
  data: {
    series: Array<{
      name: string;
      data: Array<{ x: string | number; y: number }>;
    }>;
  };
  source: DataSource;
};

// 3. Bar chart — vertical u horizontal
type BarChartWidget = {
  type: 'bar-chart';
  id: string;
  position: Position;
  config: BaseConfig & {
    orientation?: 'vertical' | 'horizontal';
    stacked?: boolean;
    showValues?: boolean;
  };
  data: {
    categories: string[];
    series: Array<{
      name: string;
      data: number[];
    }>;
  };
  source: DataSource;
};

// 4. Pie chart — distribución
type PieChartWidget = {
  type: 'pie-chart';
  id: string;
  position: Position;
  config: BaseConfig & {
    variant?: 'pie' | 'donut';  // donut es el default moderno
    showLabels?: boolean;
    showPercent?: boolean;
  };
  data: Array<{
    label: string;
    value: number;
    color?: ThemeColor;
  }>;
  source: DataSource;
};

// 5. Area chart — área bajo línea
type AreaChartWidget = {
  type: 'area-chart';
  id: string;
  position: Position;
  config: BaseConfig & {
    stacked?: boolean;
    smooth?: boolean;
    gradient?: boolean;         // gradiente de relleno
  };
  data: {
    series: Array<{
      name: string;
      data: Array<{ x: string | number; y: number }>;
    }>;
  };
  source: DataSource;
};

// 6. Scatter — correlación
type ScatterWidget = {
  type: 'scatter';
  id: string;
  position: Position;
  config: BaseConfig & {
    xLabel?: string;
    yLabel?: string;
    showTrendline?: boolean;
  };
  data: Array<{
    x: number;
    y: number;
    label?: string;
    group?: string;
  }>;
  source: DataSource;
};

// ❌ ELIMINADOS v0.2: HeatmapWidget, FunnelWidget, StackedBarWidget
// Casos de uso nicho, +2-3 semanas de render PDF sin beneficio proporcional.
// Si se piden en Fase 2, agregar al final de este archivo con schema nuevo.

// 9. Table — tabla con columnas
type TableWidget = {
  type: 'table';
  id: string;
  position: Position;
  config: BaseConfig & {
    columns: Array<{
      key: string;
      label: string;
      format?: 'currency' | 'number' | 'percent' | 'date' | 'text';
      align?: 'left' | 'center' | 'right';
      sortable?: boolean;
    }>;
    pagination?: boolean;
    pageSize?: number;
    searchable?: boolean;
  };
  data: Array<Record<string, unknown>>;
  source: DataSource;
};

// ❌ ELIMINADO v0.2: StackedBarWidget (redundante con BarChart stacked option)
```

### 3.3 Union type del widget system

```typescript
// 3. UNION type de los 7 widgets soportados
// ❌ ELIMINADOS v0.2 (auditoría 2026-07-21): HeatmapWidget, FunnelWidget, StackedBarWidget
// Razones: caso de uso nicho + +2-3 semanas de render PDF sin beneficio proporcional.
type Widget =
  | KPIWidget
  | LineChartWidget
  | BarChartWidget
  | PieChartWidget
  | AreaChartWidget
  | ScatterWidget
  | TableWidget;
```

## 4. Renderer architecture

### 4.1 Componente principal

```typescript
// components/widgets/WidgetRenderer.tsx
type Props = {
  widget: Widget;
  theme: Theme;
  isEditing?: boolean;
};

export function WidgetRenderer({ widget, theme, isEditing }: Props) {
  switch (widget.type) {
    case 'kpi': return <KPIWidget widget={widget} theme={theme} />;
    case 'line-chart': return <LineChartWidget widget={widget} theme={theme} />;
    case 'bar-chart': return <BarChartWidget widget={widget} theme={theme} />;
    case 'pie-chart': return <PieChartWidget widget={widget} theme={theme} />;
    case 'area-chart': return <AreaChartWidget widget={widget} theme={theme} />;
    case 'scatter': return <ScatterWidget widget={widget} theme={theme} />;
    case 'table': return <TableWidget widget={widget} theme={theme} />;
    // exhaustive check: TypeScript error si agregamos un type sin case
  }
}
```

### 4.2 Registry pattern

Para extensibilidad (futuro: widgets custom), usamos un registry:

```typescript
// lib/widgets/registry.ts
type WidgetRenderer = {
  type: Widget['type'];
  component: React.ComponentType<{ widget: any; theme: Theme }>;
  schema: ZodSchema;  // validación
  defaultConfig: BaseConfig;
  description: string; // para el system prompt de la IA
};

const registry: Map<string, WidgetRenderer> = new Map([
  ['kpi', kpiRenderer],
  ['line-chart', lineChartRenderer],
  ['bar-chart', barChartRenderer],
  ['pie-chart', pieChartRenderer],
  ['area-chart', areaChartRenderer],
  ['scatter', scatterRenderer],
  ['table', tableRenderer],
]);

export function getRenderer(type: string): WidgetRenderer | undefined {
  return registry.get(type);
}

export function supportedWidgetTypes(): WidgetRenderer[] {
  return Array.from(registry.values());
}
```

El array `supportedWidgetTypes()` se inyecta al system prompt de la IA (ver `ai-generate-dashboards.md` §6.2) para que solo pueda elegir entre estos 7 tipos.

### 4.3 Layout grid (12-column responsive)

```typescript
// components/dashboard/DashboardGrid.tsx
// Usa CSS Grid con 12 columnas (responsive: 12 desktop, 6 tablet, 4 mobile)
// Drag-drop con @dnd-kit (NO react-grid-layout, ver manual-editing.md §4)

type DashboardLayout = {
  widgets: Widget[];
};

// Cada widget se posiciona via gridColumn + gridRow en CSS
// Drag handle en modo edit (visible solo si isEditing=true)
```

## 5. Themes (2 curados)

MVP incluye 2 themes. Ver `layouts-themes.md` para el detalle completo.

| Theme | Uso | Look |
|-------|-----|------|
| `moderno-saas` | Dashboards para SaaS, marketing, growth (default) | Cards grandes, gradients suaves, Linear/Vercel style |
| `corporate` | Reportes para gerencia, finanzas | Tablas densas, sidebar persistente, métricas compactas |

**Theme define:**
- Color palette (primary, secondary, success, warning, danger, muted, accent)
- Font family (sans-serif moderno)
- Spacing (compacto vs spacious)
- Chart styles (smooth vs sharp, default donut vs pie)
- Border radius (sharp vs rounded)
- Background (white)

**Roadmap Fase 2:** `executive` (mobile-first, KPIs grandes) y `analyst` (drill-down, multi-chart grid). Documentados en `layouts-themes.md` history.

## 6. Validación Zod

```typescript
// lib/widgets/schemas.ts
import { z } from 'zod';

const PositionSchema = z.object({
  col: z.number().min(1).max(12),
  row: z.number().min(1),
  colSpan: z.number().min(1).max(12),
  rowSpan: z.number().min(1).max(6),
});

const DataSourceSchema = z.object({
  kind: z.literal('query'),
  dataSourceId: z.string(),
  query: z.unknown(),  // validado por connector type en query-engine
  refresh: z.object({
    mode: z.enum(['live', 'cached-ttl', 'manual']),
    ttlSeconds: z.number().min(0).optional(),
  }).optional(),
});

const KPIWidgetSchema = z.object({
  type: z.literal('kpi'),
  id: z.string(),
  position: PositionSchema,
  config: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    format: z.enum(['currency', 'number', 'percent']).optional(),
    showDelta: z.boolean().default(true),
    deltaFormat: z.enum(['currency', 'number', 'percent']).optional(),
    deltaType: z.enum(['absolute', 'percent']).optional(),
    comparisonPeriod: z.enum(['previous', 'last_year', 'last_month', 'last_week']).optional(),
    icon: z.string().optional(),
  }),
  data: z.object({
    value: z.number(),
    delta: z.number().optional(),
    target: z.number().optional(),
  }).nullable(),  // null si la query falló (error state)
  source: DataSourceSchema,
});

// ... schemas para los otros 6 widgets (line-chart, bar-chart, pie-chart, area-chart, scatter, table)

const WidgetSchema = z.discriminatedUnion('type', [
  KPIWidgetSchema, LineChartWidgetSchema, BarChartWidgetSchema,
  PieChartWidgetSchema, AreaChartWidgetSchema, ScatterWidgetSchema,
  TableWidgetSchema,
]);
```

Nota: `data` es nullable. Cuando la query falla, el query engine asigna `data: null` + `error: {...}` para que el widget muestre error state sin romper el dashboard.

## 7. System prompt para la IA

El prompt que va al LLM se genera dinámicamente desde el registry (`supportedWidgetTypes()`). Ver `specs/ai-generate-dashboards.md` §6.2 para el template completo.

Reglas inyectadas al system prompt:
1. Solo estos 7 tipos: `kpi`, `line-chart`, `bar-chart`, `pie-chart`, `area-chart`, `scatter`, `table`
2. Cada widget tiene `position` (grid 12 columnas, 1-indexed)
3. Los themes disponibles son: `moderno-saas`, `corporate`
4. Máximo 12 widgets por dashboard (rendimiento)
5. Para KPIs: `colSpan` 3-4 (3-4 cards por fila)
6. Para charts grandes: `colSpan` 6-8
7. SIEMPRE devuelve JSON válido
8. `source.kind: 'query'` — nunca `'inline'` ni `'computed'`
9. La query puede ser SQL (Postgres) o un objeto de operación (Stripe, Sheets)

## 8. Acceptance criteria

El widget-system está completo cuando:

- [ ] Los 7 tipos de widget tienen schema Zod definido
- [ ] Cada widget tiene un componente React funcional con Tremor/Recharts (o shadcn charts)
- [ ] El renderer mapea `widget.type` → componente correcto (exhaustive switch)
- [ ] Cada widget respeta el theme activo (colors, fonts, spacing via CSS variables)
- [ ] El layout grid es responsive (12 → 6 → 4 columns)
- [ ] La validación Zod rechaza JSON malformado con error legible
- [ ] El system prompt genera widgets válidos el 90%+ de las veces
- [ ] Después de 3 retries fallidos, error claro al usuario (sin fallback template)
- [ ] Cada widget es accesible (keyboard nav, screen reader labels)
- [ ] Cuando `source.query` falla, widget muestra error state sin romper el dashboard
- [ ] `data: null` + `error: {...}` es el shape del error state

## 9. Out of scope (MVP)

- ❌ Widgets custom por el usuario (registry extensibility lo permite, pero UI para crear widgets nuevos)
- ❌ Widgets con código Python ejecutado (como Briefer)
- ❌ Animaciones avanzadas en charts (Tremor default está bien)
- ❌ Drill-down (click en un widget abre otro dashboard)
- ❌ Export de widget individual (solo dashboard completo)
- ❌ Heatmap / Funnel / Stacked-bar widgets (eliminados en auditoría v0.2)

## 10. Dependencias

```json
{
  "dependencies": {
    "@tremor/react": "^3.18.0",
    "recharts": "^2.15.0",      // Tremor usa Recharts por debajo
    "lucide-react": "^0.469.0", // iconos
    "zod": "^3.24.0"
  }
}
```

`react-grid-layout` **NO** es dependencia: el drag-drop del editor usa `@dnd-kit/core` + `@dnd-kit/sortable` (ver `manual-editing.md` §4).

## 11. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| IA devuelve JSON inválido | Zod validation + retry con error + error claro al usuario |
| IA devuelve widget types que no existen | Discriminated union + exhaustive switch + error claro |
| Performance con muchos widgets | Máximo 12 widgets por dashboard, lazy loading si necesario |
| Theme inconsistente entre widgets | Theme provider central + CSS variables, todos consumen context |
| Responsive rompe layouts | Mobile-first, test en 3 breakpoints |
| Query falla y rompe dashboard | Widget error state (data: null) + Promise.allSettled en query engine |

## 12. Specs relacionados

- `ai-generate-dashboards.md` — usa este schema como output del LLM
- `dashboard-archetypes.md` — vocabulario de patrones + 8 archetypes + axes de variación (v0.4)
- `layouts-themes.md` — los 2 themes disponibles (moderno-saas, corporate)
- `manual-editing.md` — edit mode preserva el archetype y permite cambiarlo desde un dropdown
- `multi-tenant.md` — permisos sobre widgets/dashboards