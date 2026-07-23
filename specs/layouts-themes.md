# Spec: Layouts & Themes

> Sistema de temas visuales que dash-bi aplica a los dashboards. La IA elige el theme según el contexto del prompt.

**Status:** Draft v0.3 (sync 2026-07-21)
**Prioridad:** P1 — sin esto los dashboards se ven genéricos
**Responsable:** codehak
**Depende de:** `widget-system.md`

---

## Cambios respecto a v0.2 (sync 2026-07-21)

**v0.3 (correcciones de consistencia):**
- ❌ Eliminadas secciones §2.3 (`executive`) y §2.4 (`analyst`) del spec activo. Las decisiones de paleta/tipografía se movieron al **roadmap** §5.
- ✅ `ThemeId` type union es solo `'moderno-saas' | 'corporate'`
- ✅ `THEMES` record solo contiene 2 entries
- ✅ Heurística de IA en system prompt (§4.1) solo menciona 2 themes
- ✅ Acceptance criteria §6: "Los 2 themes están definidos" (no 4)

**Decisiones aplicadas (post-auditoría 2026-07-21):**
- ❌ Eliminados: `executive` y `analyst` themes (casos de uso nicho, +1 semana de implementación).
- ✅ Quedan **2 themes**: `moderno-saas` (default) y `corporate` (formal).
- Executive y analyst quedan como **roadmap Fase 2+**.

---

## 1. Objetivo

Definir **2 themes visuales** que:

1. **Cubran casos de uso diferentes** (default moderno-saas vs formal corporate)
2. **Sean visualmente consistentes** — no se mezclan estilos
3. **Definan todo el sistema de diseño** — colors, fonts, spacing, shadows, radius
4. **Sean aplicables a cualquier widget** sin código custom por widget
5. **Sean configurables por org** (default theme por org)

---

## 2. Los 2 themes (MVP)

### 2.1 `moderno-saas` — Default

**Vibe:** Linear, Vercel, Stripe Dashboard, Notion

**Cuándo la IA lo elige:**
- Prompt menciona "dashboard", "SaaS", "growth", "marketing", "general"
- Sin contexto específico
- **Default si no hay señal**

**Paleta de colores:**
```
primary:    #6366F1  (indigo-500, vibrante)
secondary:  #8B5CF6  (violet-500)
success:    #10B981  (emerald-500)
warning:    #F59E0B  (amber-500)
danger:     #EF4444  (red-500)
muted:      #6B7280  (gray-500)
accent:     #EC4899  (pink-500)
background: #FFFFFF
surface:    #F9FAFB  (gray-50)
border:     #E5E7EB  (gray-200)
text:       #111827  (gray-900)
textMuted:  #6B7280  (gray-500)
```

**Tipografía:**
- Font family: Inter (sans-serif moderno)
- Heading weights: 600 (semibold)
- Body weights: 400 (regular), 500 (medium)
- KPI numbers: 700 (bold), tamaño grande

**Spacing & layout:**
- Card padding: 24px
- Card gap: 16px
- Border radius: 12px (rounded suave)
- Shadows: sutiles (shadow-sm)

**Chart styles:**
- Line charts: smooth curves, gradient fill opcional
- Bar charts: rounded top corners
- Pie charts: donut (con hueco central) por default
- Area charts: gradient fill (de primary a transparente)

**Iconos:** lucide-react, weight normal

**Brand inspiration:** Linear.app, Vercel.com, Stripe dashboard

### 2.2 `corporate` — Reportes para gerencia, finanzas

**Vibe:** Bloomberg Terminal meets Salesforce, Tableau clásico

**Cuándo la IA lo elige:**
- Prompt menciona "reporte", "gerencia", "finanzas", "Q1/Q2/Q3", "trimestral", "formal"
- "Ejecutivo" pero con tono formal
- "Para presentar a directorio"

**Paleta de colores:**
```
primary:    #1E40AF  (blue-800, serio)
secondary:  #475569  (slate-600)
success:    #15803D  (green-700)
warning:    #B45309  (amber-700)
danger:     #B91C1C  (red-700)
muted:      #64748B  (slate-500)
accent:     #0E7490  (cyan-700)
background: #FFFFFF
surface:    #F8FAFC  (slate-50)
border:     #CBD5E1  (slate-300)
text:       #0F172A  (slate-900)
textMuted:  #475569  (slate-600)
```

**Tipografía:**
- Font family: Inter (sans-serif) o Source Sans Pro
- Heading weights: 700 (bold)
- Body weights: 400 (regular)
- KPI numbers: 700, tamaño grande

**Spacing & layout:**
- Card padding: 16px (más compacto)
- Card gap: 12px
- Border radius: 4px (esquinas sutiles)
- Shadows: ninguna, solo borders definidos

**Chart styles:**
- Line charts: sharp/angular, sin gradient
- Bar charts: esquinas rectas, bordes visibles
- Pie charts: pie completo (sin donut)
- Area charts: fill sólido (no gradient)
- Tablas: líneas horizontales visibles, header gris

**Datos prioritarios:**
- Números exactos siempre visibles
- Tablas con todas las columnas
- Menos "resumen", más detalle

**Brand inspiration:** Bloomberg, Salesforce Reports, Tableau clásico

---

## 3. Implementación técnica

### 3.1 Theme provider

```typescript
// lib/themes/types.ts

export type ThemeId = 'moderno-saas' | 'corporate';

export type Theme = {
  id: ThemeId;
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    danger: string;
    muted: string;
    accent: string;
    background: string;
    surface: string;
    border: string;
    text: string;
    textMuted: string;
  };
  typography: {
    fontFamily: string;
    fontFamilyMono?: string;
    headingWeight: number;
    bodyWeight: number;
    kpiWeight: number;
    baseSize: number;
  };
  spacing: {
    cardPadding: string;
    cardGap: string;
    borderRadius: string;
  };
  shadows: {
    card: string;
  };
  chartStyles: {
    lineSmooth: boolean;
    barRounded: boolean;
    pieVariant: 'pie' | 'donut';
    areaGradient: boolean;
    showGrid: boolean;
  };
};

export const THEMES: Record<ThemeId, Theme> = {
  'moderno-saas': { ... },
  'corporate': { ... },
};
// ❌ Removidos v0.3: `executive`, `analyst` (movidos al roadmap §5)
```

### 3.2 CSS variables (la magia)

Cada theme se aplica vía CSS variables en `:root` o un wrapper:

```typescript
// lib/themes/apply.ts

export function applyTheme(themeId: ThemeId) {
  const theme = THEMES[themeId];

  return `
    :root[data-theme="${themeId}"] {
      --color-primary: ${theme.colors.primary};
      --color-secondary: ${theme.colors.secondary};
      --color-success: ${theme.colors.success};
      --color-warning: ${theme.colors.warning};
      --color-danger: ${theme.colors.danger};
      --color-muted: ${theme.colors.muted};
      --color-accent: ${theme.colors.accent};
      --color-background: ${theme.colors.background};
      --color-surface: ${theme.colors.surface};
      --color-border: ${theme.colors.border};
      --color-text: ${theme.colors.text};
      --color-text-muted: ${theme.colors.textMuted};

      --font-family: ${theme.typography.fontFamily};
      --font-family-mono: ${theme.typography.fontFamilyMono || theme.typography.fontFamily};
      --font-heading-weight: ${theme.typography.headingWeight};
      --font-body-weight: ${theme.typography.bodyWeight};
      --font-kpi-weight: ${theme.typography.kpiWeight};
      --font-base-size: ${theme.typography.baseSize}px;

      --spacing-card-padding: ${theme.spacing.cardPadding};
      --spacing-card-gap: ${theme.spacing.cardGap};
      --spacing-border-radius: ${theme.spacing.borderRadius};

      --shadow-card: ${theme.shadows.card};

      --chart-line-smooth: ${theme.chartStyles.lineSmooth ? 'true' : 'false'};
      --chart-bar-rounded: ${theme.chartStyles.barRounded ? 'true' : 'false'};
      --chart-pie-variant: ${theme.chartStyles.pieVariant};
      --chart-area-gradient: ${theme.chartStyles.areaGradient ? 'true' : 'false'};
      --chart-show-grid: ${theme.chartStyles.showGrid ? 'true' : 'false'};
    }
  `;
}
```

### 3.3 Aplicación en React

```typescript
// components/dashboard/DashboardThemeProvider.tsx

'use client';

import { useEffect } from 'react';
import { applyTheme } from '@/lib/themes/apply';
import type { ThemeId } from '@/lib/themes/types';

export function DashboardThemeProvider({
  themeId,
  children,
}: {
  themeId: ThemeId;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = applyTheme(themeId);
    style.setAttribute('data-theme-style', themeId);
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, [themeId]);

  return (
    <div data-theme={themeId} className="dashboard-root">
      {children}
    </div>
  );
}
```

### 3.4 Widgets consumen CSS variables

```typescript
// components/widgets/KPIWidget.tsx

export function KPIWidget({ widget, theme }) {
  return (
    <Card className="kpi-widget">
      <div className="kpi-label">{widget.config.title}</div>
      <div className="kpi-value">{formatValue(widget.data.value, widget.config.format)}</div>
      {widget.config.showDelta && widget.data.delta !== undefined && (
        <div className={`kpi-delta ${widget.data.delta >= 0 ? 'positive' : 'negative'}`}>
          {widget.data.delta >= 0 ? '↑' : '↓'} {Math.abs(widget.data.delta)}%
        </div>
      )}
    </Card>
  );
}
```

```css
/* styles/widgets.css */

[data-theme] .kpi-widget {
  background: var(--color-surface);
  padding: var(--spacing-card-padding);
  border-radius: var(--spacing-border-radius);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-card);
}

[data-theme] .kpi-label {
  color: var(--color-text-muted);
  font-size: 14px;
  font-weight: var(--font-body-weight);
}

[data-theme] .kpi-value {
  color: var(--color-text);
  font-size: 32px;
  font-weight: var(--font-kpi-weight);
  font-family: var(--font-family);
}

[data-theme] .kpi-delta.positive {
  color: var(--color-success);
}

[data-theme] .kpi-delta.negative {
  color: var(--color-danger);
}
```

### 3.5 Charts consumen CSS variables

```typescript
// components/widgets/LineChartWidget.tsx

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export function LineChartWidget({ widget, theme }) {
  // Read CSS variables at runtime
  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue('--color-primary').trim();
  const secondary = styles.getPropertyValue('--color-secondary').trim();
  const success = styles.getPropertyValue('--color-success').trim();
  const smooth = styles.getPropertyValue('--chart-line-smooth').trim() === 'true';
  const showGrid = styles.getPropertyValue('--chart-show-grid').trim() === 'true';

  const colors = [primary, secondary, success, '#F59E0B', '#EC4899', '#06B6D4'];

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={widget.data.series[0].data}>
        <CartesianGrid strokeDasharray="3 3" stroke={showGrid ? '#E5E7EB' : 'transparent'} />
        <XAxis dataKey="x" />
        <YAxis />
        <Tooltip />
        <Legend />
        {widget.data.series.map((s, i) => (
          <Line
            key={s.name}
            type={smooth ? 'monotone' : 'linear'}
            dataKey="y"
            data={s.data}
            name={s.name}
            stroke={colors[i % colors.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

---

## 4. Sistema de IA: cómo elige el theme

### 4.1 Heurística en el system prompt (v0.3, solo 2 themes)

```typescript
// lib/ai/theme-selector.ts

export const THEME_SELECTION_RULES = `
# THEME SELECTION

Elige el theme basándote en señales del prompt:

## moderno-saas (DEFAULT)
- Palabras clave: "dashboard", "general", "métricas", "SaaS"
- Sin contexto específico
- Growth, marketing, producto

## corporate
- Palabras clave: "reporte", "gerencia", "finanzas", "Q1/Q2/Q3/Q4", "trimestral"
- "Para presentar a directorio/junta"
- Tono formal, datos contables

Si no hay señal clara, usa 'moderno-saas'.
`;
// ❌ Removidos v0.3: `executive`, `analyst`
```

### 4.2 Override por org

```typescript
// db/schema.ts
export const orgs = pgTable('orgs', {
  // ...
  defaultTheme: text('default_theme').$type<ThemeId>().default('moderno-saas'),
});
```

Esto permite que una empresa tenga su theme default (ej: "siempre usa corporate").

---

## 5. Roadmap Fase 2+ (NO en MVP)

Los siguientes themes quedaron fuera del MVP por decisión post-auditoría 2026-07-21.

### 5.1 `executive` (planeado Fase 2)

- **Vibe:** Apple Keynote slide meets Stripe Atlas
- **Cuándo elegirlo:** "CEO", "resumen", "weekly report", "mobile", "1 página"
- **Diferencia vs moderno-saas:** mobile-first, KPI 800-weight gigante, un solo chart grande

### 5.2 `analyst` (planeado Fase 2)

- **Vibe:** Jupyter meets Observable, Tableau Public
- **Cuándo elegirlo:** "análisis", "explorar", "comparar", "cohorte", "funnel", "retention"
- **Diferencia vs moderno-saas:** multi-chart grid denso, drill-down, comparaciones A/B

### 5.3 Dark mode (planeado Fase 2)

Cada theme MVP tendría su variante dark. Implementación: cada `Theme` incluye un campo `dark?: Theme`. UI toggle: Light / Dark / Auto (sistema).

**Roadmap post-MVP:**
```typescript
// Fase 2
export const THEMES: Record<ThemeId, Theme> = {
  'moderno-saas': { /* light */, dark: { /* dark */ } },
  'corporate':    { /* light */, dark: { /* dark */ } },
  'executive':    { /* … */ },
  'analyst':      { /* … */ },
};
```

---

## 6. Acceptance criteria

El sistema de themes está completo cuando:

- [ ] Los 2 themes (`moderno-saas`, `corporate`) están definidos con colores, fonts, spacing, shadows
- [ ] CSS variables se aplican via `DashboardThemeProvider`
- [ ] Cada widget consume CSS variables (no hardcoded colors)
- [ ] Los charts consumen CSS variables (Tremor/Recharts via `getComputedStyle`)
- [ ] La IA elige el theme correcto según las reglas del system prompt
- [ ] El theme default de la org se respeta
- [ ] El switch de theme es instantáneo (no recarga)
- [ ] Mobile responsive en los 2 themes
- [ ] Dark mode se difiere a Fase 2 (no en MVP)

## 7. Out of scope (MVP)

- ❌ `executive` y `analyst` themes (Fase 2+)
- ❌ Dark mode (Fase 2+)
- ❌ Custom themes por org (Fase 2+)
- ❌ Theme marketplace (Fase 3)
- ❌ Branded themes (logo + colors custom) (Fase 2+)
- ❌ CSS-in-JS dinámico por theme

## 8. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Charts no respetan CSS vars | Wrapper que lee `getComputedStyle` y pasa colors a Recharts |
| Performance: aplicar theme genera reflow | CSS variables no causan reflow, solo repaint |
| IA elige theme inconsistente | Few-shot examples + reglas explícitas en system prompt |
| Tema personalizado rompe widgets (Fase 2) | Limitar customización (solo colors primary/accent, no estructura) |

## 9. Inspiración visual (referencias)

| Theme | Inspiración | URL |
|-------|-------------|-----|
| moderno-saas | Linear | linear.app |
| moderno-saas | Vercel | vercel.com |
| corporativo | Bloomberg | bloomberg.com |
| corporativo | Salesforce Reports | salesforce.com/reports |

(Referencia para Fase 2+:)
| Fase 2+ | Inspiración | URL |
|--------|-------------|-----|
| executive | Apple Keynote | apple.com/keynote |
| executive | Stripe Atlas | stripe.com/atlas |
| analyst | Observable | observablehq.com |
| analyst | Tableau Public | public.tableau.com |

## 10. Dependencias

```json
{
  "dependencies": {
    "@tremor/react": "^3.18.0",   // usa CSS vars internamente
    "recharts": "^2.15.0",
    "lucide-react": "^0.469.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  }
}
```

## 11. Specs relacionados

- `widget-system.md` — los widgets consumen estos themes (referencia a "2 themes")
- `ai-generate-dashboards.md` — la IA elige el theme (system prompt en §6)
- `multi-tenant.md` — org puede tener theme default (schema `orgs.defaultTheme`)
