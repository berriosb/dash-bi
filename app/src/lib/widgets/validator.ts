import { z } from 'zod';
import type { Dashboard, ArchetypeId } from './types';
import { requireArchetype, isArchetypeId } from './archetypes';
import { slotContainsWidget } from './atomic-patterns';

export type ArchetypeValidationError = {
  kind:
    | 'too_many_widgets'
    | 'too_few_widgets'
    | 'forbidden_widget_type'
    | 'missing_required_slot'
    | 'multiple_widgets_in_single_slot'
    | 'unknown_archetype'
    | 'widgets_overlap'
    | 'widget_out_of_bounds';
  slot?: string;
  widgetId?: string;
  widgetA?: string;
  widgetB?: string;
  axis?: 'col' | 'colSpan' | 'row' | 'rowSpan';
  value?: number;
  expected?: number;
  got?: number;
  type?: string;
  allowed?: string[];
  archetype?: ArchetypeId;
  message: string;
};

export type ArchetypeValidationResult = {
  valid: boolean;
  errors: ArchetypeValidationError[];
  warnings: string[];
};

export function validateArchetype(dashboard: Dashboard): ArchetypeValidationResult {
  const errors: ArchetypeValidationError[] = [];
  const warnings: string[] = [];

  if (!dashboard.archetype) {
    return { valid: true, errors, warnings: ['Sin archetype — edición libre'] };
  }

  if (dashboard.archetype === 'custom') {
    return { valid: true, errors, warnings: ['Archetype custom — sin constraints'] };
  }

  if (!isArchetypeId(dashboard.archetype)) {
    errors.push({
      kind: 'unknown_archetype',
      archetype: dashboard.archetype,
      message: `Archetype "${dashboard.archetype}" no existe en el catálogo`,
    });
    return { valid: false, errors, warnings };
  }

  const archetype = requireArchetype(dashboard.archetype);

  if (dashboard.widgets.length > archetype.maxWidgets) {
    errors.push({
      kind: 'too_many_widgets',
      archetype: dashboard.archetype,
      expected: archetype.maxWidgets,
      got: dashboard.widgets.length,
      message: `Archetype "${archetype.name}" acepta máximo ${archetype.maxWidgets} widgets, se encontraron ${dashboard.widgets.length}`,
    });
  }

  for (const slot of archetype.slots) {
    const widgetsInSlot = dashboard.widgets.filter(w =>
      slotContainsWidget(
        slot,
        w.position.col,
        w.position.row,
        w.position.colSpan,
        w.position.rowSpan,
      ),
    );

    if (slot.minCount > 0 && widgetsInSlot.length < slot.minCount) {
      errors.push({
        kind: 'missing_required_slot',
        slot: slot.id,
        archetype: dashboard.archetype,
        expected: slot.minCount,
        got: widgetsInSlot.length,
        message: `Slot "${slot.label}" requiere al menos ${slot.minCount} widget(s), se encontraron ${widgetsInSlot.length}`,
      });
    }

    if (slot.maxCount === 1 && widgetsInSlot.length > 1) {
      errors.push({
        kind: 'multiple_widgets_in_single_slot',
        slot: slot.id,
        archetype: dashboard.archetype,
        message: `Slot "${slot.label}" acepta máximo 1 widget, se encontraron ${widgetsInSlot.length}`,
      });
    }

    for (const widget of widgetsInSlot) {
      if (!slot.allowedTypes.includes(widget.type)) {
        errors.push({
          kind: 'forbidden_widget_type',
          slot: slot.id,
          widgetId: widget.id,
          archetype: dashboard.archetype,
          type: widget.type,
          allowed: slot.allowedTypes,
          message: `Widget "${widget.id}" (tipo "${widget.type}") no está permitido en el slot "${slot.label}". Tipos permitidos: ${slot.allowedTypes.join(', ')}`,
        });
      }
    }
  }

  // Overlap check (Sprint 1 v0.2): ningún widget puede ocupar la misma celda que otro
  // Ver `dashboard-archetypes.md §8` para la justificación.
  for (let i = 0; i < dashboard.widgets.length; i++) {
    for (let j = i + 1; j < dashboard.widgets.length; j++) {
      const a = dashboard.widgets[i];
      const b = dashboard.widgets[j];
      if (!a || !b) continue;
      if (widgetsOverlap(a.position, b.position)) {
        errors.push({
          kind: 'widgets_overlap',
          widgetA: a.id,
          widgetB: b.id,
          archetype: dashboard.archetype,
          message: `Widgets "${a.id}" y "${b.id}" se solapan en el grid 12-col. Mover uno de ellos.`,
        });
      }
    }
  }

  // Bounds check: widgets deben estar dentro del grid 12-col
  for (const w of dashboard.widgets) {
    if (w.position.col < 1 || w.position.col > 12) {
      errors.push({
        kind: 'widget_out_of_bounds',
        widgetId: w.id,
        axis: 'col',
        value: w.position.col,
        archetype: dashboard.archetype,
        message: `Widget "${w.id}" tiene col=${w.position.col} fuera de rango [1, 12].`,
      });
    }
    if (w.position.col + w.position.colSpan - 1 > 12) {
      errors.push({
        kind: 'widget_out_of_bounds',
        widgetId: w.id,
        axis: 'colSpan',
        value: w.position.colSpan,
        archetype: dashboard.archetype,
        message: `Widget "${w.id}" excede el ancho del grid (col=${w.position.col} + colSpan=${w.position.colSpan} > 12).`,
      });
    }
    if (w.position.row < 1) {
      errors.push({
        kind: 'widget_out_of_bounds',
        widgetId: w.id,
        axis: 'row',
        value: w.position.row,
        archetype: dashboard.archetype,
        message: `Widget "${w.id}" tiene row=${w.position.row} fuera de rango (>=1).`,
      });
    }
    if (w.position.rowSpan > 6) {
      errors.push({
        kind: 'widget_out_of_bounds',
        widgetId: w.id,
        axis: 'rowSpan',
        value: w.position.rowSpan,
        archetype: dashboard.archetype,
        message: `Widget "${w.id}" tiene rowSpan=${w.position.rowSpan} > 6 (máximo permitido).`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detecta si dos posiciones se solapan en el grid 12-col.
 * Dos widgets se solapan si sus rangos [col, col+colSpan) × [row, row+rowSpan)
 * tienen intersección no-vacía.
 *
 * Helper exportado para tests.
 */
export function widgetsOverlap(
  a: { col: number; row: number; colSpan: number; rowSpan: number },
  b: { col: number; row: number; colSpan: number; rowSpan: number },
): boolean {
  const aEndCol = a.col + a.colSpan;
  const aEndRow = a.row + a.rowSpan;
  const bEndCol = b.col + b.colSpan;
  const bEndRow = b.row + b.rowSpan;
  return !(aEndCol <= b.col || bEndCol <= a.col || aEndRow <= b.row || bEndRow <= a.row);
}

export const ArchetypeEnum = z.enum([
  'kpi-grid',
  'hero-focus',
  'cohort-matrix',
  'sales-pipeline',
  'executive-summary',
  'operations-live',
  'finance-report',
  'growth-metrics',
  'custom',
]);

export const DensityEnum = z.enum(['spacious', 'balanced', 'dense']);
export const ThemeAccentEnum = z.enum(['default', 'accent', 'muted']);
export const TimeWindowEnum = z.enum([
  'last_24h',
  'last_7d',
  'last_30d',
  'last_quarter',
  'last_90d',
  'last_6mo',
  'last_year',
  'all_time',
]);

export const ComparativoEnum = z.enum([
  'none',
  'previous_period',
  'previous_month',
  'previous_quarter',
  'previous_year',
  'last_year_same_week',
]);

export const ArchetypeVariantSchema = z.object({
  density: DensityEnum,
  accent: ThemeAccentEnum,
  timeWindow: TimeWindowEnum,
  comparativo: ComparativoEnum,
});

export const WidgetTypeEnum = z.enum([
  'kpi',
  'line-chart',
  'bar-chart',
  'pie-chart',
  'area-chart',
  'scatter',
  'table',
]);

const PositionSchema = z.object({
  col: z.number().min(1).max(12),
  row: z.number().min(1),
  colSpan: z.number().min(1).max(12),
  rowSpan: z.number().min(1).max(6),
});

const RefreshSchema = z.object({
  mode: z.enum(['live', 'cached-ttl', 'manual']),
  ttlSeconds: z.number().min(0).optional(),
});

const DataSourceSchema = z.object({
  kind: z.literal('query'),
  dataSourceId: z.string(),
  query: z.unknown(),
  refresh: RefreshSchema.optional(),
});

const WidgetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('kpi'), id: z.string(), position: PositionSchema, config: z.unknown(), data: z.unknown(), source: DataSourceSchema }),
  z.object({ type: z.literal('line-chart'), id: z.string(), position: PositionSchema, config: z.unknown(), data: z.unknown(), source: DataSourceSchema }),
  z.object({ type: z.literal('bar-chart'), id: z.string(), position: PositionSchema, config: z.unknown(), data: z.unknown(), source: DataSourceSchema }),
  z.object({ type: z.literal('pie-chart'), id: z.string(), position: PositionSchema, config: z.unknown(), data: z.unknown(), source: DataSourceSchema }),
  z.object({ type: z.literal('area-chart'), id: z.string(), position: PositionSchema, config: z.unknown(), data: z.unknown(), source: DataSourceSchema }),
  z.object({ type: z.literal('scatter'), id: z.string(), position: PositionSchema, config: z.unknown(), data: z.unknown(), source: DataSourceSchema }),
  z.object({ type: z.literal('table'), id: z.string(), position: PositionSchema, config: z.unknown(), data: z.unknown(), source: DataSourceSchema }),
]);

export const DashboardZodSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  theme: z.enum(['moderno-saas', 'corporate']),
  widgets: z.array(WidgetSchema).max(12),
  archetype: ArchetypeEnum.optional(),
  archetypeVariant: ArchetypeVariantSchema.optional(),
});

export function validateDashboardWithArchetype(dashboard: unknown): {
  zodValid: boolean;
  zodErrors: string[];
  archetypeValid: boolean;
  archetypeErrors: ArchetypeValidationError[];
} {
  const result = DashboardZodSchema.safeParse(dashboard);

  if (!result.success) {
    return {
      zodValid: false,
      zodErrors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      archetypeValid: true,
      archetypeErrors: [],
    };
  }

  const archetypeResult = validateArchetype(result.data as Dashboard);

  return {
    zodValid: true,
    zodErrors: [],
    archetypeValid: archetypeResult.valid,
    archetypeErrors: archetypeResult.errors,
  };
}

export function isValidArchetypeForWidgetCount(
  archetypeId: ArchetypeId,
  widgetCount: number,
): boolean {
  if (archetypeId === 'custom') return true;
  if (!isArchetypeId(archetypeId)) return false;
  return widgetCount <= requireArchetype(archetypeId).maxWidgets;
}

export function archetypeConstraintsSummary(archetypeId: ArchetypeId): string {
  if (archetypeId === 'custom') return 'custom (sin constraints)';
  if (!isArchetypeId(archetypeId)) return 'unknown';
  const a = requireArchetype(archetypeId);
  const slotsSummary = a.slots
    .map(s => `${s.id}:${s.minCount}-${s.maxCount}×${s.allowedTypes.join('|')}`)
    .join(', ');
  return `${a.name} (max ${a.maxWidgets} widgets). Slots: ${slotsSummary}`;
}
