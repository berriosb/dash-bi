import type { WidgetType } from './types';

export type AtomicPatternId =
  | 'hero-metric'
  | 'kpi-row'
  | 'chart-spotlight'
  | 'comparison-grid'
  | 'data-table'
  | 'timeline'
  | 'breakdown-list';

export type Slot = {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  allowedTypes: WidgetType[];
  minCount: number;
  maxCount: number;
  label: string;
};

export type AtomicPattern = {
  id: AtomicPatternId;
  name: string;
  description: string;
  slots: Slot[];
  widgetCount: { min: number; max: number };
  defaultRow: number;
};

export const ATOMIC_PATTERNS: Record<AtomicPatternId, AtomicPattern> = {
  'hero-metric': {
    id: 'hero-metric',
    name: 'Hero metric',
    description: 'Single KPI en posición destacada (6 col, alto). Ideal para la métrica principal.',
    defaultRow: 1,
    slots: [
      {
        id: 'hero',
        col: 1,
        row: 1,
        colSpan: 6,
        rowSpan: 2,
        allowedTypes: ['kpi'],
        minCount: 1,
        maxCount: 1,
        label: 'Hero KPI',
      },
    ],
    widgetCount: { min: 1, max: 1 },
  },

  'kpi-row': {
    id: 'kpi-row',
    name: 'KPI row',
    description: 'Fila de 3-6 KPIs distribuídos uniformemente en el ancho completo.',
    defaultRow: 1,
    slots: [
      {
        id: 'kpis',
        col: 1,
        row: 1,
        colSpan: 12,
        rowSpan: 1,
        allowedTypes: ['kpi'],
        minCount: 3,
        maxCount: 6,
        label: 'Mini KPIs',
      },
    ],
    widgetCount: { min: 3, max: 6 },
  },

  'chart-spotlight': {
    id: 'chart-spotlight',
    name: 'Chart spotlight',
    description: 'Un chart grande full-width con leyenda prominente.',
    defaultRow: 1,
    slots: [
      {
        id: 'spotlight',
        col: 1,
        row: 1,
        colSpan: 12,
        rowSpan: 4,
        allowedTypes: ['line-chart', 'bar-chart', 'area-chart', 'scatter', 'pie-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Chart grande',
      },
    ],
    widgetCount: { min: 1, max: 1 },
  },

  'comparison-grid': {
    id: 'comparison-grid',
    name: 'Comparison grid',
    description: 'Dos charts idénticos lado a lado (cols 1-6 y 7-12).',
    defaultRow: 1,
    slots: [
      {
        id: 'left',
        col: 1,
        row: 1,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'bar-chart', 'area-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Chart izquierdo',
      },
      {
        id: 'right',
        col: 7,
        row: 1,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'bar-chart', 'area-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Chart derecho',
      },
    ],
    widgetCount: { min: 2, max: 2 },
  },

  'data-table': {
    id: 'data-table',
    name: 'Data table',
    description: 'Tabla completa full-width con paginación y búsqueda.',
    defaultRow: 1,
    slots: [
      {
        id: 'table',
        col: 1,
        row: 1,
        colSpan: 12,
        rowSpan: 4,
        allowedTypes: ['table'],
        minCount: 1,
        maxCount: 1,
        label: 'Tabla',
      },
    ],
    widgetCount: { min: 1, max: 1 },
  },

  'timeline': {
    id: 'timeline',
    name: 'Timeline',
    description: 'Line/area chart con eje temporal explícito.',
    defaultRow: 1,
    slots: [
      {
        id: 'timeline',
        col: 1,
        row: 1,
        colSpan: 12,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Serie temporal',
      },
    ],
    widgetCount: { min: 1, max: 1 },
  },

  'breakdown-list': {
    id: 'breakdown-list',
    name: 'Breakdown list',
    description: 'Pie o bar chart mostrando distribución / proporciones.',
    defaultRow: 1,
    slots: [
      {
        id: 'breakdown',
        col: 1,
        row: 1,
        colSpan: 12,
        rowSpan: 4,
        allowedTypes: ['pie-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Distribución',
      },
    ],
    widgetCount: { min: 1, max: 1 },
  },
};

export const ATOMIC_PATTERN_IDS: AtomicPatternId[] = [
  'hero-metric',
  'kpi-row',
  'chart-spotlight',
  'comparison-grid',
  'data-table',
  'timeline',
  'breakdown-list',
];

export function getAtomicPattern(id: AtomicPatternId): AtomicPattern {
  return ATOMIC_PATTERNS[id];
}

export function getAllAtomicPatterns(): AtomicPattern[] {
  return ATOMIC_PATTERN_IDS.map(id => ATOMIC_PATTERNS[id]);
}

export function widgetCountForPattern(id: AtomicPatternId): { min: number; max: number } {
  return ATOMIC_PATTERNS[id].widgetCount;
}

export function isAtomicPatternId(value: unknown): value is AtomicPatternId {
  return typeof value === 'string' && value in ATOMIC_PATTERNS;
}

export function slotContainsWidget(
  slot: Slot,
  widgetCol: number,
  widgetRow: number,
  widgetColSpan: number,
  widgetRowSpan: number,
): boolean {
  const colEnd = slot.col + slot.colSpan;
  const rowEnd = slot.row + slot.rowSpan;

  return (
    widgetCol >= slot.col &&
    widgetCol + widgetColSpan <= colEnd &&
    widgetRow >= slot.row &&
    widgetRow + widgetRowSpan <= rowEnd
  );
}
