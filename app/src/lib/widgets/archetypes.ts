import type { ArchetypeId, ArchetypeVariant, Density, TimeWindow, ThemeAccent, Comparativo, ThemeId } from './types';
import type { AtomicPatternId } from './atomic-patterns';

export type ArchetypeCategory =
  | 'general'
  | 'focus'
  | 'analytical'
  | 'commercial'
  | 'executive'
  | 'operations'
  | 'finance'
  | 'growth';

import type { Slot } from './atomic-patterns';

export type ArchetypeTemplate = {
  id: ArchetypeId;
  name: string;
  tagline: string;
  category: ArchetypeCategory;
  description: string;
  keywords: string[];
  atomicPatterns: AtomicPatternId[];
  recommendedDensity: Density;
  recommendedAccent: ThemeAccent;
  recommendedTimeWindow: TimeWindow;
  recommendedComparativo: Comparativo;
  recommendedTheme: ThemeId | 'auto';
  maxWidgets: number;
  slots: Slot[];
};

export const ARCHETYPE_KEYWORDS: Record<Exclude<ArchetypeId, 'custom'>, string[]> = {
  'kpi-grid': ['dashboard', 'general', 'overview', 'métricas', 'metrica', 'resumen general', 'vista general'],
  'hero-focus': ['destaca', 'destacar', 'foco', 'hero', 'único número', 'unico numero', 'lo más importante', 'lo mas importante', 'kpi destacado'],
  'cohort-matrix': ['cohorte', 'cohort', 'retention', 'retención', 'ltv cohorte', 'engagement', 'engagement en el tiempo'],
  'sales-pipeline': ['pipeline', 'embudo', 'leads', 'deals', 'oportunidades', 'negocio', 'ventas pipeline'],
  'executive-summary': ['ejecutivo', 'resumen', 'weekly report', 'jefe', '1 página', '1 pagina', 'master', 'ceo', 'vista para el jefe', 'directorio'],
  'operations-live': ['operaciones', 'live', 'monitoreo', 'monitor', 'status', 'salud', 'uptime', 'servicios', 'health'],
  'finance-report': ['reporte financiero', 'p&l', 'p and l', 'p y l', 'ingresos vs gastos', 'balance', 'finanzas', 'trimestral', 'quarterly', 'ebitda'],
  'growth-metrics': ['growth', 'marketing', 'adquisición', 'adquisicion', 'conversión', 'conversion', 'cac', 'ltv', 'funnel de adquisición', 'engagement'],
};

const KPI_ROW_SLOT: (row: number) => Slot = (row) => ({
  id: 'kpis',
  col: 1,
  row,
  colSpan: 12,
  rowSpan: 1,
  allowedTypes: ['kpi'],
  minCount: 3,
  maxCount: 6,
  label: 'KPI row',
});

const CHART_SLOT: (row: number, id?: string, label?: string) => Slot = (row, id = 'chart', label = 'Trend chart') => ({
  id,
  col: 1,
  row,
  colSpan: 12,
  rowSpan: 3,
  allowedTypes: ['line-chart', 'area-chart'],
  minCount: 1,
  maxCount: 1,
  label,
});

export const ARCHETYPES: Record<Exclude<ArchetypeId, 'custom'>, ArchetypeTemplate> = {
  'kpi-grid': {
    id: 'kpi-grid',
    name: 'KPI Grid',
    tagline: 'Vista general con KPIs + chart',
    category: 'general',
    description: '6 KPIs en grid + 1 line chart grande. Default para data sources genéricos.',
    keywords: ARCHETYPE_KEYWORDS['kpi-grid'],
    atomicPatterns: ['kpi-row', 'chart-spotlight'],
    recommendedDensity: 'balanced',
    recommendedAccent: 'default',
    recommendedTimeWindow: 'last_30d',
    recommendedComparativo: 'previous_period',
    recommendedTheme: 'moderno-saas',
    maxWidgets: 8,
    slots: [
      { ...KPI_ROW_SLOT(1), minCount: 4, maxCount: 6 },
      CHART_SLOT(2),
    ],
  },

  'hero-focus': {
    id: 'hero-focus',
    name: 'Hero Focus',
    tagline: 'Métrica destacada + contexto',
    category: 'focus',
    description: '1 KPI hero (6 col) + 3 mini KPIs + 1 chart grande. Para cuando el usuario sabe cuál métrica importa.',
    keywords: ARCHETYPE_KEYWORDS['hero-focus'],
    atomicPatterns: ['hero-metric', 'kpi-row', 'chart-spotlight'],
    recommendedDensity: 'spacious',
    recommendedAccent: 'accent',
    recommendedTimeWindow: 'last_30d',
    recommendedComparativo: 'previous_period',
    recommendedTheme: 'auto',
    maxWidgets: 5,
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
        label: 'Hero metric',
      },
      {
        id: 'kpis',
        col: 7,
        row: 1,
        colSpan: 6,
        rowSpan: 2,
        allowedTypes: ['kpi'],
        minCount: 3,
        maxCount: 3,
        label: 'Mini KPIs',
      },
      {
        id: 'chart',
        col: 1,
        row: 3,
        colSpan: 12,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Supporting chart',
      },
    ],
  },

  'cohort-matrix': {
    id: 'cohort-matrix',
    name: 'Cohort Matrix',
    tagline: 'Análisis de cohortes + retention',
    category: 'analytical',
    description: 'Hero LTV de la última cohorte + timeline de retention + breakdown por canal + tabla de cohortes.',
    keywords: ARCHETYPE_KEYWORDS['cohort-matrix'],
    atomicPatterns: ['hero-metric', 'timeline', 'breakdown-list', 'data-table'],
    recommendedDensity: 'dense',
    recommendedAccent: 'muted',
    recommendedTimeWindow: 'last_6mo',
    recommendedComparativo: 'previous_period',
    recommendedTheme: 'moderno-saas',
    maxWidgets: 4,
    slots: [
      {
        id: 'hero',
        col: 1,
        row: 1,
        colSpan: 4,
        rowSpan: 2,
        allowedTypes: ['kpi'],
        minCount: 1,
        maxCount: 1,
        label: 'Latest cohort LTV',
      },
      {
        id: 'retention',
        col: 5,
        row: 1,
        colSpan: 8,
        rowSpan: 2,
        allowedTypes: ['line-chart', 'area-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Retention curve',
      },
      {
        id: 'breakdown',
        col: 1,
        row: 3,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['pie-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Channel breakdown',
      },
      {
        id: 'table',
        col: 7,
        row: 3,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['table'],
        minCount: 1,
        maxCount: 1,
        label: 'Cohort table',
      },
    ],
  },

  'sales-pipeline': {
    id: 'sales-pipeline',
    name: 'Sales Pipeline',
    tagline: 'Embudo de ventas comercial',
    category: 'commercial',
    description: '4 KPIs pipeline + 2 charts comparativos + tabla de top deals. Para CRMs.',
    keywords: ARCHETYPE_KEYWORDS['sales-pipeline'],
    atomicPatterns: ['kpi-row', 'comparison-grid', 'data-table'],
    recommendedDensity: 'balanced',
    recommendedAccent: 'default',
    recommendedTimeWindow: 'last_90d',
    recommendedComparativo: 'previous_quarter',
    recommendedTheme: 'moderno-saas',
    maxWidgets: 7,
    slots: [
      { id: 'kpis', col: 1, row: 1, colSpan: 12, rowSpan: 1, allowedTypes: ['kpi'], minCount: 4, maxCount: 4, label: 'Pipeline KPIs' },
      {
        id: 'left',
        col: 1,
        row: 2,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Stage progression',
      },
      {
        id: 'right',
        col: 7,
        row: 2,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Time-to-close',
      },
      {
        id: 'table',
        col: 1,
        row: 5,
        colSpan: 12,
        rowSpan: 4,
        allowedTypes: ['table'],
        minCount: 1,
        maxCount: 1,
        label: 'Top deals',
      },
    ],
  },

  'executive-summary': {
    id: 'executive-summary',
    name: 'Executive Summary',
    tagline: 'Vista para CEO/jefe, 1 página',
    category: 'executive',
    description: '1 KPI mega + 1 chart grande + tabla compacta. Espacioso, theme corporate.',
    keywords: ARCHETYPE_KEYWORDS['executive-summary'],
    atomicPatterns: ['hero-metric', 'chart-spotlight', 'data-table'],
    recommendedDensity: 'spacious',
    recommendedAccent: 'accent',
    recommendedTimeWindow: 'last_quarter',
    recommendedComparativo: 'previous_quarter',
    recommendedTheme: 'corporate',
    maxWidgets: 3,
    slots: [
      {
        id: 'hero',
        col: 1,
        row: 1,
        colSpan: 8,
        rowSpan: 3,
        allowedTypes: ['kpi'],
        minCount: 1,
        maxCount: 1,
        label: 'Mega KPI',
      },
      {
        id: 'chart',
        col: 9,
        row: 1,
        colSpan: 4,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart'],
        minCount: 0,
        maxCount: 1,
        label: 'Side chart (opcional)',
      },
      {
        id: 'table',
        col: 1,
        row: 4,
        colSpan: 12,
        rowSpan: 3,
        allowedTypes: ['table'],
        minCount: 0,
        maxCount: 1,
        label: 'Compact table (opcional)',
      },
    ],
  },

  'operations-live': {
    id: 'operations-live',
    name: 'Operations Live',
    tagline: 'Monitoreo en tiempo real',
    category: 'operations',
    description: '4 KPIs live + timeline corta + comparación vs SLA.',
    keywords: ARCHETYPE_KEYWORDS['operations-live'],
    atomicPatterns: ['kpi-row', 'timeline', 'comparison-grid'],
    recommendedDensity: 'balanced',
    recommendedAccent: 'default',
    recommendedTimeWindow: 'last_24h',
    recommendedComparativo: 'previous_period',
    recommendedTheme: 'corporate',
    maxWidgets: 7,
    slots: [
      { id: 'kpis', col: 1, row: 1, colSpan: 12, rowSpan: 1, allowedTypes: ['kpi'], minCount: 4, maxCount: 4, label: 'Live KPIs' },
      {
        id: 'timeline',
        col: 1,
        row: 2,
        colSpan: 12,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Live timeline',
      },
      {
        id: 'left',
        col: 1,
        row: 5,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Now vs target',
      },
      {
        id: 'right',
        col: 7,
        row: 5,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'SLA compliance',
      },
    ],
  },

  'finance-report': {
    id: 'finance-report',
    name: 'Finance Report',
    tagline: 'P&L / reporte financiero trimestral',
    category: 'finance',
    description: '4-6 KPIs currency + breakdown + tabla de líneas. Densidad high, theme corporate.',
    keywords: ARCHETYPE_KEYWORDS['finance-report'],
    atomicPatterns: ['kpi-row', 'breakdown-list', 'data-table'],
    recommendedDensity: 'dense',
    recommendedAccent: 'muted',
    recommendedTimeWindow: 'last_quarter',
    recommendedComparativo: 'previous_quarter',
    recommendedTheme: 'corporate',
    maxWidgets: 8,
    slots: [
      { id: 'kpis', col: 1, row: 1, colSpan: 12, rowSpan: 1, allowedTypes: ['kpi'], minCount: 4, maxCount: 6, label: 'Financial KPIs' },
      {
        id: 'breakdown',
        col: 1,
        row: 2,
        colSpan: 6,
        rowSpan: 4,
        allowedTypes: ['pie-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Cost / revenue breakdown',
      },
      {
        id: 'table',
        col: 7,
        row: 2,
        colSpan: 6,
        rowSpan: 4,
        allowedTypes: ['table'],
        minCount: 1,
        maxCount: 1,
        label: 'Line items detail',
      },
    ],
  },

  'growth-metrics': {
    id: 'growth-metrics',
    name: 'Growth Metrics',
    tagline: 'Métricas de growth / marketing',
    category: 'growth',
    description: '4 charts comparativos (acquisition + retention + cohorts + LTV) + 3 KPIs al final.',
    keywords: ARCHETYPE_KEYWORDS['growth-metrics'],
    atomicPatterns: ['comparison-grid', 'comparison-grid', 'kpi-row'],
    recommendedDensity: 'balanced',
    recommendedAccent: 'default',
    recommendedTimeWindow: 'last_6mo',
    recommendedComparativo: 'previous_period',
    recommendedTheme: 'moderno-saas',
    maxWidgets: 7,
    slots: [
      {
        id: 'left',
        col: 1,
        row: 1,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Acquisition channels',
      },
      {
        id: 'right',
        col: 7,
        row: 1,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'area-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Retention curves',
      },
      {
        id: 'left-2',
        col: 1,
        row: 4,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'bar-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'Cohort behavior',
      },
      {
        id: 'right-2',
        col: 7,
        row: 4,
        colSpan: 6,
        rowSpan: 3,
        allowedTypes: ['line-chart', 'bar-chart', 'pie-chart'],
        minCount: 1,
        maxCount: 1,
        label: 'LTV distribution',
      },
      {
        id: 'kpis',
        col: 1,
        row: 7,
        colSpan: 12,
        rowSpan: 1,
        allowedTypes: ['kpi'],
        minCount: 3,
        maxCount: 3,
        label: 'Growth KPIs (CAC, LTV, ratio)',
      },
    ],
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as Exclude<ArchetypeId, 'custom'>[];

export const ARCHETYPE_LIST: ArchetypeTemplate[] = ARCHETYPE_IDS.map(id => ARCHETYPES[id]);

export const ARCHETYPE_CATEGORIES: ArchetypeCategory[] = [
  'general', 'focus', 'analytical', 'commercial', 'executive', 'operations', 'finance', 'growth',
];

export function isArchetypeId(value: unknown): value is ArchetypeId {
  return typeof value === 'string' && (value === 'custom' || value in ARCHETYPES);
}

export function isCuratedArchetype(value: unknown): value is Exclude<ArchetypeId, 'custom'> {
  return typeof value === 'string' && value in ARCHETYPES;
}

export function getArchetype(id: ArchetypeId): ArchetypeTemplate | null {
  if (id === 'custom') return null;
  return ARCHETYPES[id] ?? null;
}

export function requireArchetype(id: Exclude<ArchetypeId, 'custom'>): ArchetypeTemplate {
  return ARCHETYPES[id];
}

export function getArchetypesByCategory(category: ArchetypeCategory): ArchetypeTemplate[] {
  return ARCHETYPE_LIST.filter(a => a.category === category);
}

export function defaultVariantFor(id: Exclude<ArchetypeId, 'custom'>): ArchetypeVariant {
  const a = ARCHETYPES[id];
  return {
    density: a.recommendedDensity,
    accent: a.recommendedAccent,
    timeWindow: a.recommendedTimeWindow,
    comparativo: a.recommendedComparativo,
  };
}

export function variantAxes(): Array<'density' | 'accent' | 'timeWindow' | 'comparativo'> {
  return ['density', 'accent', 'timeWindow', 'comparativo'];
}

export const DENSITY_RULES: Record<Density, {
  cardPadding: string;
  cardGap: string;
  maxWidgets: number;
}> = {
  spacious: { cardPadding: '32px', cardGap: '24px', maxWidgets: 6 },
  balanced: { cardPadding: '24px', cardGap: '16px', maxWidgets: 12 },
  dense: { cardPadding: '16px', cardGap: '12px', maxWidgets: 12 },
};

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  last_24h: 'Últimas 24 horas',
  last_7d: 'Últimos 7 días',
  last_30d: 'Últimos 30 días',
  last_quarter: 'Último trimestre',
  last_90d: 'Últimos 90 días',
  last_6mo: 'Últimos 6 meses',
  last_year: 'Último año',
  all_time: 'Todo el histórico',
};
