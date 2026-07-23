# Spec: Manual Dashboard Editing

> Edición manual de dashboards después de que la IA los genera. Drag-and-drop, panel de propiedades, agregar/quitar widgets. Diseñado para ser **tan fácil como Notion o Linear**, no como Tableau.

**Status:** Draft v0.2 (sync 2026-07-21)
**Prioridad:** P0 — sin modo manual, si la IA falla el usuario está atrapado
**Responsable:** codehak
**Depende de:** `widget-system.md`

---

## Cambios respecto a v0.1 (sync 2026-07-21)

**v0.2 (correcciones de consistencia):**
- ❌ **Removido `react-grid-layout`** del stack. Se usa **`@dnd-kit/core` + `@dnd-kit/sortable`** (estándar 2026, accesible, sin fricción con React 19).
- ✅ Sección §4 completamente reescrita con el patrón `@dnd-kit` + grid semantics propio (12 columnas).
- ✅ **Historial de versiones**: las ediciones manuales ahora crean versiones en `dashboard_versions` (antes solo se versionaban generaciones IA).
- ✅ **Optimistic updates con TanStack Query** para auto-save (no más `fetch` directo en el hook).
- ✅ Confirmado: stack de forms `react-hook-form` + Zod.

---

## 1. Objetivo

Permitir que el usuario edite un dashboard generado por IA de forma **manual e intuitiva**:

1. **Mover widgets** — drag-and-drop en grid de 12 columnas
2. **Editar widget existente** — click → panel lateral con sus propiedades
3. **Agregar widget** — botón "+" → menú con los 7 tipos → config básica → listo
4. **Quitar widget** — click derecho → "Eliminar" (con undo)
5. **Cambiar theme** — switch entre moderno-saas y corporate (1 click)
6. **Undo/redo** — Ctrl+Z / Ctrl+Shift+Z como en cualquier editor moderno
7. **Save manual** — cambios se guardan automáticamente (no botón "Save")

**Principio de diseño:** "Si necesitas pensar cómo usarlo, está mal diseñado."

---

## 2. Principios UX

### 2.1 Familiar, no revolucionario

El usuario ya sabe usar:
- Notion (drag blocks, click para editar)
- Linear (sidebar de propiedades)
- Figma (panel derecho con propiedades)
- Google Docs (auto-save)

**Tomamos lo mejor de cada uno:**
- **Drag** estilo Notion (no estilo Figma con handles raros)
- **Panel de propiedades** estilo Linear (sidebar derecho, limpio)
- **Auto-save** estilo Google Docs (sin botón Save)
- **Undo/redo** estilo cualquier editor moderno

### 2.2 Edición no rompe nada

- Los cambios se aplican **in-place** sobre el JSON del dashboard
- Validación en cada cambio (no se puede dejar un widget "roto")
- Si la query falla, el widget muestra estado de error pero no rompe el dashboard

### 2.3 Modo dual

- **Modo View:** dashboard read-only (default para viewers y links públicos)
- **Modo Edit:** dashboard editable (default para admin/editor en su org)

Switch con un botón "Edit" en el top-right, o automáticamente según el rol.

---

## 3. Vista principal en modo Edit

```
┌─────────────────────────────────────────────────────────────┐
│  [← Dashboards]   Q3 Revenue Dashboard              [👁 View] │
│                                                              │
│  [+ Add widget]  [🎨 Theme: Modern SaaS ▾]  [⚙ Settings]  │
├──────────────────────────────────────────────────────────────┤
│                                              │ Properties   │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐    │             │
│   │ Revenue  │ │ Customers│ │ Churn    │    │ KPI         │
│   │ $45.2K   │ │ 1,234    │ │ 3.2%     │    │             │
│   │ +12% ↑   │ │ +8% ↑    │ │ -0.8% ↓  │    │ Title       │
│   └──────────┘ └──────────┘ └──────────┘    │ [Revenue  ] │
│                                              │             │
│   ┌─────────────────────────────────────┐   │ Format      │
│   │                                     │   │ [Currency ▾]│
│   │        Revenue monthly              │   │             │
│   │                                     │   │ Query       │
│   │                                     │   │ [stripe →  ]│
│   └─────────────────────────────────────┘   │             │
│                                              │ [× Remove]  │
└──────────────────────────────────────────────────────────────┘
```

**Sin chat de IA en modo manual.** El chat está disponible solo en modo "AI generate". En manual, solo edición visual.

---

## 4. Drag-and-drop de widgets

### 4.1 Stack (corregido v0.2)

- **`@dnd-kit/core`** + **`@dnd-kit/sortable`** (estándar 2026, ~2.8M weekly downloads, accesible built-in)
- Semantics de grid propias (NO usamos react-grid-layout por fricción histórica con React 19)
- Responsive: 12 columnas desktop, 6 tablet, 4 mobile (via CSS Grid + media queries)
- Snap a grid 12-columnas: el `onDragEnd` redondea la posición a la celda más cercana

### 4.2 Comportamiento

- **Hover sobre widget (modo edit):** aparece un handle (icono de drag) en top-left
- **Click + drag:** mueve el widget, los demás se reacomodan (auto-flow vertical, no overlap)
- **Drop:** snap a la grid más cercana (calcula `col` y `row` 1-indexed)
- **Touch devices:** long-press + drag funciona igual (dnd-kit lo soporta)
- **Keyboard:** flechas mueven 1 celda; Shift+flechas 4 celdas (accesibilidad built-in dnd-kit)

### 4.3 Resize

- **Esquina inferior-derecha:** handle de resize
- Mantiene aspect ratio por default (Shift para free resize)
- Snap a múltiplos de grid 12-col

### 4.4 Implementación

```tsx
// components/dashboard/DashboardGrid.tsx
'use client';

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { useState } from 'react';

export function DashboardGrid({ dashboard, isEditing, onLayoutChange }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const [layout, setLayout] = useState(() =>
    dashboard.widgets.map(w => ({
      id: w.id,
      col: w.position.col,
      row: w.position.row,
      colSpan: w.position.colSpan,
      rowSpan: w.position.rowSpan,
    }))
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, delta } = event;
    const id = String(active.id);
    const cols = 12;
    const rowHeight = 60; // px
    const colWidth = 100; // px

    const colDelta = Math.round(delta.x / colWidth);
    const rowDelta = Math.round(delta.y / rowHeight);

    setLayout(prev => {
      const next = prev.map(item => {
        if (item.id !== id) return item;
        const newCol = Math.max(1, Math.min(cols - item.colSpan + 1, item.col + colDelta));
        const newRow = Math.max(1, item.row + rowDelta);
        return { ...item, col: newCol, row: newRow };
      });
      onLayoutChange(next);
      return next;
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="dashboard-grid">
        {layout.map(item => (
          <DraggableWidget key={item.id} id={item.id} isEditing={isEditing}>
            <WidgetRenderer widget={dashboard.widgets.find(w => w.id === item.id)!} isEditing={isEditing} />
          </DraggableWidget>
        ))}
      </div>
    </DndContext>
  );
}

function DraggableWidget({ id, isEditing, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  if (!isEditing) return <div className="widget-wrapper">{children}</div>;
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'widget-wrapper dragging' : 'widget-wrapper'}>
      <div className="drag-handle" {...listeners} {...attributes}>⠿</div>
      {children}
    </div>
  );
}
```

### 4.5 Grid CSS (responsive)

```css
/* styles/dashboard.css */

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 60px;
  gap: 16px;
  padding: 24px;
}

.widget-wrapper {
  grid-column: var(--col) / span var(--col-span);
  grid-row: var(--row) / span var(--row-span);
}

@media (max-width: 1024px) {
  .dashboard-grid { grid-template-columns: repeat(6, 1fr); }
}
@media (max-width: 640px) {
  .dashboard-grid { grid-template-columns: repeat(4, 1fr); }
}
```

Cada widget expone `--col`, `--col-span`, `--row`, `--row-span` (CSS custom properties) que se actualizan al `onDragEnd`. Snap-to-grid se aplica vía JS (arriba en `handleDragEnd`).

---

## 5. Panel de propiedades (sidebar derecho)

### 5.1 Activación

- **Click en un widget** (modo Edit) → panel se abre con sus propiedades
- **Click fuera del widget** → panel se cierra
- **Click en otro widget** → panel cambia a las propiedades de ese widget

### 5.2 Diseño del panel

```
┌─────────────────────────┐
│ ← Widget properties     │
├─────────────────────────┤
│ TYPE: KPI               │
│                         │
│ Title                   │
│ [Revenue total       ]  │
│                         │
│ Format                  │
│ [Currency           ▾]  │
│                         │
│ Show delta              │
│ [✓]                     │
│                         │
│ Delta type              │
│ [Percent            ▾]  │
│                         │
│ Comparison period       │
│ [Previous period    ▾]  │
│                         │
│ ─────────────────────── │
│ DATA SOURCE             │
│ Stripe (producción)     │
│                         │
│ Query                   │
│ getRevenue              │
│ [× Remove] [⚙ Edit SQL] │
│                         │
│ ─────────────────────── │
│ POSITION                │
│ Width:  [3 ▾]  cols     │
│ Height: [1 ▾]  rows     │
│                         │
│ [× Delete widget]       │
└─────────────────────────┘
```

### 5.3 Tipos de campos según widget type

**Común a todos:**
- Title
- Position (width, height)

**KPI:**
- Format (currency/number/percent/date)
- Show delta (toggle)
- Delta type (percent/absolute)
- Comparison period (previous/last_year/last_month/last_week)
- Icon

**Charts (line/bar/area/scatter):**
- X axis (time/category/number)
- Y axis (linear/log)
- Show legend (toggle)
- Show grid (toggle)
- Smooth (toggle, line/area only)
- Show points (toggle, line/scatter only)
- Color scheme (preset dropdown)

**Pie chart:**
- Variant (pie/donut)
- Show labels (toggle)
- Show percent (toggle)

**Table:**
- Columns (lista editable: add/remove/reorder)
- Pagination (toggle)
- Page size (number)
- Searchable (toggle)

### 5.4 Edición de query

Para mantener el principio "fácil", la edición de query tiene 2 niveles:

**Nivel 1 (default, fácil):**
- Dropdown con queries pre-definidas del data source
- Para Stripe: `getRevenue`, `listCharges`, `listCustomers`, etc.
- Para Postgres: queries guardadas (si existen) o templates comunes

**Nivel 2 (avanzado, opcional):**
- Editor de código (SQL para Postgres, JSON para Stripe)
- Solo se muestra si el usuario hace click en "⚙ Edit SQL"
- Validación en tiempo real (errores rojos)

**Principio:** el 90% de los usuarios nunca necesita Nivel 2. Está ahí para el 10% que sabe.

---

## 6. Agregar widget nuevo

### 6.1 Flujo

```
1. Click "+ Add widget"
2. Modal/menu con los 7 tipos (icono + nombre + descripción corta)
3. Click en un tipo
4. Form mínimo:
   - Title (input)
   - Data source (dropdown)
   - Query/operation (dropdown según data source)
   - Position (auto: primer espacio vacío)
5. Click "Add"
6. Widget aparece en el dashboard, se selecciona automáticamente
7. Panel de propiedades se abre para ajustes finos
```

### 6.2 UI del selector

```
┌────────────────────────────────────┐
│ Add widget                         │
├────────────────────────────────────┤
│  📊 Number           ▸             │
│  📈 Line chart       ▸             │
│  📊 Bar chart        ▸             │
│  🥧 Pie chart        ▸             │
│  📉 Area chart       ▸             │
│  ⚬ Scatter           ▸             │
│  📋 Table            ▸             │
│                                    │
│  Or use AI: [🤖 Generate with AI]  │
└────────────────────────────────────┘
```

**Doble camino:** manual (agregar widget específico) o AI (volver al chat para que genere lo que querés).

---

## 7. Eliminar widget

- **Click derecho** → menú contextual con "Delete widget"
- **Panel de propiedades** → botón "× Delete widget" al final
- **Undo (Ctrl+Z)** recupera el widget eliminado

**Confirmación:** NO pedimos confirmación. Es reversible (undo). Friction innecesaria.

---

## 8. Undo / Redo

### 8.1 Stack

- **`zundo`** (wrapper sobre Zustand, 500 stars)
- Stack de hasta 50 acciones (limit profundidad)
- Persiste en memoria (no en DB) — si recargás, el historial se pierde (OK para MVP)
- **Solo patches**: `zundo` guarda el diff entre estados, no snapshots completos (memoria acotada)
- **No persiste resultados de queries** (esos vienen del query-engine cache, no del undo stack)

### 8.2 Keyboard shortcuts

| Acción | Shortcut |
|--------|----------|
| Undo | Ctrl+Z / Cmd+Z |
| Redo | Ctrl+Shift+Z / Cmd+Shift+Z |
| Save (manual trigger) | Ctrl+S (no necesario, auto-save) |
| Switch to view mode | Esc |

### 8.3 Acciones trackeadas

- Add widget
- Remove widget
- Move widget (drag end)
- Resize widget
- Edit widget property (title, format, etc.)
- Edit query
- Change theme

### 8.4 Acciones NO trackeadas

- Hover, focus, selección
- Carga inicial
- Cambios de UI (tema del navegador, dark mode)
- Cache hits de queries (esos son del query-engine, no del usuario)

---

## 9. Auto-save

### 9.1 Comportamiento

- **No hay botón Save.** Los cambios se guardan automáticamente.
- **Debounce de 1 segundo** después del último cambio → save al servidor
- **Indicador sutil** en el top-right: "Guardado" / "Guardando..." / "Error al guardar"
- **Optimistic update** con TanStack Query: la UI muestra el cambio inmediato, rollback si server rechaza

### 9.2 Implementación (v0.2 con TanStack Query)

```typescript
// hooks/use-auto-save.ts

export function useAutoSave(dashboardId: string) {
  const queryClient = useQueryClient();
  const status = useDashboardStore((s) => s.saveStatus);

  const mutation = useMutation({
    mutationFn: async (dashboard: Dashboard) => {
      const res = await fetch(`/api/dashboards/${dashboardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dashboard),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new SaveValidationError(err);
      }
      return res.json();
    },
    onMutate: async (dashboard) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['dashboard', dashboardId] });
      const prev = queryClient.getQueryData<Dashboard>(['dashboard', dashboardId]);
      queryClient.setQueryData(['dashboard', dashboardId], dashboard);
      return { prev };
    },
    onError: (err, _variables, context) => {
      // Rollback
      if (context?.prev) {
        queryClient.setQueryData(['dashboard', dashboardId], context.prev);
      }
    },
    onSuccess: () => {
      // Invalidate query engine cache (ver specs/query-engine.md §5.2)
      invalidateDashboardQueries(dashboardId);
    },
  });

  // Trigger mutation con debounce 1s
  const trigger = useDebouncedCallback((dashboard: Dashboard) => {
    mutation.mutate(dashboard);
  }, 1000);

  return { trigger, status: mutation.status };
}
```

### 9.3 Manejo de errores y conflictos de edición (Optimistic Concurrency Control)

- **Prevención de sobrescritura multi-pestaña:** El servidor valida `updatedAt` o `version`. Si otro cliente guardó primero, responde `409 Conflict`.
- Si el servidor rechaza el save (validación, conflicto), se muestra un toast:
  ```
  ⚠️ Conflicto de edición: El dashboard fue modificado en otra pestaña o usuario.
  [Recargar versión más reciente] [Deshacer mi cambio]
  ```
- El cambio problemático se revierte automáticamente (rollback del optimistic update vía `onError`).

### 9.4 Versionado de ediciones manuales (v0.2 fix)

El `PATCH /api/dashboards/:id` crea una versión en `dashboard_versions` para cada save exitoso (no solo para generaciones IA) e implementa control de concurrencia optimista.

```typescript
// app/api/dashboards/[id]/route.ts (v0.2)
export async function PATCH(req, { params }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.edit');

  const updates = await req.json();
  const validated = DashboardSchema.parse(updates);

  await withOrgContext(orgId, userId, async () => {
    await db.transaction(async (tx) => {
      // Optimistic concurrency check (evita pisar cambios de otra pestaña)
      const current = await tx.query.dashboards.findFirst({
        where: and(eq(dashboards.id, params.id), eq(dashboards.orgId, orgId)),
      });
      if (updates.updatedAt && current?.updatedAt && new Date(updates.updatedAt).getTime() < current.updatedAt.getTime()) {
        throw new ConcurrentEditConflictError('Dashboard was modified by another session');
      }

      await tx.update(dashboards)
        .set({ widgets: validated.widgets, theme: validated.theme, updatedAt: new Date() })
        .where(and(eq(dashboards.id, params.id), eq(dashboards.orgId, orgId)));

      // Crear versión (manual o IA)
      const lastVersion = await tx.query.dashboardVersions.findFirst({
        where: eq(dashboardVersions.dashboardId, params.id),
        orderBy: desc(dashboardVersions.version),
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      await tx.insert(dashboardVersions).values({
        dashboardId: params.id,
        orgId,
        version: nextVersion,
        widgets: validated.widgets,
        theme: validated.theme,
        createdBy: userId,
        // prompt y generatedBy NULL si es edición manual
      });
    });
  });

  await audit(orgId, userId, 'dashboard.updated', `dashboard:${params.id}`);
  return Response.json({ ok: true });
}
```

---

## 10. Cambio de theme

### 10.1 UI

- Dropdown en el top toolbar: `[🎨 Theme: Modern SaaS ▾]`
- 2 opciones: Modern SaaS, Corporate
- Click → cambia **instantáneamente** (CSS variables, sin reload)
- El cambio se auto-guarda

### 10.2 Por qué solo 2 opciones

Decidido en auditoría 2026-07-21 (reducir scope). El usuario puede elegir entre:
- **Modern SaaS** (default, Linear/Vercel style)
- **Corporate** (formal, Bloomberg style)

## 10.5 Cambio de archetype (v0.4)

> **v0.4:** Nueva opción en el toolbar. Cuando la IA genera un dashboard, elige un `archetype` (ver `specs/dashboard-archetypes.md`). El usuario puede cambiarlo desde un dropdown sin perder los widgets.

### 10.5.1 UI

```
Toolbar: [🎨 Theme: Modern SaaS ▾]  [📐 Archetype: KPI Grid ▾]  [+ Add widget]
            ↓                                  ↓
        2 options                         9 options (8 archetypes + custom)
```

Dropdown en el toolbar, al lado del theme selector. Las opciones son los 8 archetypes curados + `custom` (mantiene la disposición actual).

### 10.5.2 Comportamiento

- **User cambia el archetype:** los widgets se **reorganizan** automáticamente al nuevo layout. El widget data (queries, labels) se preserva cuando es posible (best-effort match).
- **Agrega/remueve widgets que no encajan:** si el nuevo archetype tiene menos slots, los widgets sobrantes pasan al panel "unused widgets" para re-agregar manualmente.
- **Custom archetype:** proteger la composición actual sin reorganizar.

### 10.5.3 Por qué permitimos editar después

El archetype es una **plantilla de partida**, no una restricción permanente. El usuario puede:

- Cambiar el archetype para probar otra disposición del mismo data
- Editar el layout libremente (drag-drop) — al mover widgets fuera de los slots del archetype, **no rompemos nada**, solo dejamos de validar
- Agregar widgets nuevos sin restricción de archetype
- Regenerar el prompt para que la IA proponga un archetype diferente

Ver `specs/dashboard-archetypes.md` §9 para el detalle de la integración edit mode.

---

## 11. Permisos por rol

| Acción | Admin | Editor | Viewer |
|--------|:-----:|:------:|:------:|
| Ver dashboard | ✅ | ✅ | ✅ |
| Entrar a modo Edit | ✅ | ✅ | ❌ |
| Agregar widget | ✅ | ✅ | ❌ |
| Eliminar widget | ✅ | ✅ | ❌ |
| Mover/resize widget | ✅ | ✅ | ❌ |
| Editar properties | ✅ | ✅ | ❌ |
| Cambiar theme | ✅ | ✅ | ❌ |
| Crear dashboard nuevo | ✅ | ✅ | ❌ |
| Eliminar dashboard | ✅ | ✅ | ❌ |

Viewer siempre ve en modo View (read-only).

---

## 12. Implementación técnica

### 12.1 Stack (v0.2)

```json
{
  "dependencies": {
    "@dnd-kit/core": "^6.3.0",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@tanstack/react-query": "^5.62.0",
    "react-hook-form": "^7.54.0",
    "use-debounce": "^10.0.0",
    "zundo": "^2.3.0",
    "zustand": "^5.0.0"
  }
}
```

> **v0.2:** `react-grid-layout` removido. `react-hook-form` agregado para forms de PropertyPanel. `use-debounce` agregado para `useDebouncedCallback` en auto-save (§9.2).

### 12.2 Estructura de componentes

```
components/
  dashboard/
    DashboardGrid.tsx          # DndContext wrapper, 12-col CSS Grid
    DashboardToolbar.tsx       # +Add widget, theme, settings
    DashboardStatusBar.tsx     # "Guardado..." indicator
    PropertyPanel/
      PropertyPanel.tsx        # Sidebar derecho (RHF + Zod)
      KpiProperties.tsx        # Properties específicas por tipo
      ChartProperties.tsx
      TableProperties.tsx
      QueryEditor.tsx          # Nivel 2 (SQL/API editor, RHF)
    AddWidgetDialog.tsx        # Modal selector de tipo (RHF)
    DraggableWidget.tsx        # useDraggable wrapper
```

### 12.3 Estado

```typescript
// stores/dashboard-store.ts
import { create } from 'zustand';
import { temporal } from 'zundo';

type DashboardStore = {
  dashboard: Dashboard;
  selectedWidgetId: string | null;
  saveStatus: 'saved' | 'saving' | 'error';

  setDashboard: (d: Dashboard) => void;
  selectWidget: (id: string | null) => void;
  addWidget: (widget: Widget, position: Position) => void;
  removeWidget: (id: string) => void;
  updateWidget: (id: string, updates: Partial<Widget>) => void;
  moveWidget: (id: string, position: Position) => void;
  setTheme: (theme: ThemeId) => void;
};

export const useDashboardStore = create<DashboardStore>()(
  temporal(
    (set) => ({
      // ...
    }),
    {
      limit: 50,                          // undo stack size
      partialize: (state) => ({ dashboard: state.dashboard }),  // solo guarda el dashboard en undo
    }
  )
);
```

> **v0.2:** `partialize` limita el undo a cambios del dashboard (no guarda `selectedWidgetId`, `saveStatus` etc. en el stack).

### 12.4 Server-side (v0.2)

Ver §9.4 — el handler PATCH ahora crea versiones en `dashboard_versions` para cada save exitoso (manual o IA).

```typescript
// app/api/dashboards/[id]/route.ts
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { orgId, userId } = await getAuthContext(req);
  await requirePermission(userId, orgId, 'dashboard.edit');

  const updates = await req.json();
  const validation = DashboardSchema.safeParse(updates);
  if (!validation.success) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  await withOrgContext(orgId, userId, async () => {
    await db.transaction(async (tx) => {
      await tx.update(dashboards)
        .set({
          widgets: validation.data.widgets,
          theme: validation.data.theme,
          updatedAt: new Date(),
        })
        .where(and(eq(dashboards.id, params.id), eq(dashboards.orgId, orgId)));

      // Crear versión (v0.2)
      const last = await tx.query.dashboardVersions.findFirst({
        where: eq(dashboardVersions.dashboardId, params.id),
        orderBy: desc(dashboardVersions.version),
      });
      await tx.insert(dashboardVersions).values({
        dashboardId: params.id,
        orgId,
        version: (last?.version ?? 0) + 1,
        widgets: validation.data.widgets,
        theme: validation.data.theme,
        createdBy: userId,
      });
    });
  });

  await invalidateDashboardQueries(params.id);  // query-engine cache
  await audit(orgId, userId, 'dashboard.updated', `dashboard:${params.id}`);
  return Response.json({ ok: true });
}
```

---

## 13. Acceptance criteria

El modo manual está completo cuando:

- [ ] Usuario puede entrar a modo Edit con 1 click
- [ ] Drag-and-drop funciona en desktop (mouse) y mobile (touch)
- [ ] Click en widget abre panel de propiedades con sus campos correctos
- [ ] Panel permite editar title, format, query, position
- [ ] Botón "+ Add widget" abre selector con los 7 tipos
- [ ] Cada tipo tiene su form mínimo (title + query)
- [ ] Widget nuevo aparece en posición auto (primer espacio)
- [ ] Eliminar widget funciona (click derecho o botón)
- [ ] Undo (Ctrl+Z) revierte la última acción
- [ ] Redo (Ctrl+Shift+Z) reaplica la acción deshecha
- [ ] Auto-save guarda cambios después de 1s de inactividad
- [ ] Indicador visual muestra "Guardado" / "Guardando..." / "Error"
- [ ] Theme se cambia con 1 click (instantáneo)
- [ ] Viewer no puede entrar a modo Edit (botón oculto o disabled)
- [ ] Modo dual: Edit ↔ View con toggle visible

---

## 14. Out of scope (MVP)

- ❌ Drag-and-drop entre dashboards (cross-dashboard)
- ❌ Copy/paste de widgets entre dashboards
- ❌ Templates pre-hechos (Fase 2)
- ❌ Versioning visual (diff entre versiones) — el historial existe pero no se muestra UI
- ❌ Collaborative editing (múltiples usuarios editando simultáneo) (Fase 3)
- ❌ Comments / annotations en widgets (Fase 3)
- ❌ Mobile-optimized property panel (responsive pero no mobile-first)

---

## 15. Roadmap

**Fase 2 (semana 5-6):**
- Templates pre-hechos por industria
- Copy/paste entre dashboards
- Bulk edit (seleccionar múltiples widgets, aplicar mismo format)

**Fase 3 (semana 7-8):**
- Collaborative editing (Yjs/CRDT)
- Comments en widgets
- Versioning visual con diff

---

## 16. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Drag-and-drop se siente "tosco" en mobile | Testear en iOS Safari + Android Chrome desde día 1 |
| Property panel overwhelma con campos | Progressive disclosure (campos básicos arriba, avanzados en "More") |
| Undo/redo confunde a usuarios no técnicos | Limitar a 50 acciones, documentar Ctrl+Z en onboarding |
| Auto-save race conditions (cambios simultáneos) | Debounce 1s + última escritura gana + warning si hay conflicto |
| Cambios manuales rompen queries generadas por IA | Validación Zod en server-side, revertir cambio si falla |
| Performance con muchos widgets (>15) | Virtualización del grid (Fase 2) |

---

## 17. Especificación de UI mínima (pixel guidance)

Para el implementador, guía de cómo debe verse:

**Toolbar:**
- Altura: 48px
- Background: var(--color-surface)
- Border-bottom: 1px var(--color-border)
- Botones: estilo shadcn/ui "outline" o "ghost"
- Dropdown theme: estilo shadcn/ui "select"

**Widget en modo Edit:**
- Border: 2px dashed var(--color-primary) cuando seleccionado
- Border: 1px transparent cuando no seleccionado (hover: 1px var(--color-border))
- Cursor: move (sobre el handle), pointer (sobre el resto)
- Drag handle: aparece top-left al hover, 24x24px

**Property panel:**
- Width: 320px
- Background: var(--color-surface)
- Border-left: 1px var(--color-border)
- Padding: 24px
- Sections separadas con `<hr>` sutil
- Labels: 12px, var(--color-text-muted), uppercase, tracking-wide
- Inputs: estilo shadcn/ui standard

---

## 18. Specs relacionados

- `widget-system.md` — schema de widgets + tipo `Dashboard.archetype`
- `ai-generate-dashboards.md` — la IA genera el JSON inicial (incluye archetype)
- `dashboard-archetypes.md` — vocabulario de patrones + 9 archetypes editables
- `multi-tenant.md` — permisos por rol
- `layouts-themes.md` — 2 themes disponibles