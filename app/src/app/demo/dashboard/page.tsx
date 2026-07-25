import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import type { Dashboard } from '@/lib/widgets/types';

const DEMO_DATA_SOURCE = {
  kind: 'query' as const,
  dataSourceId: 'demo-source',
  query: { kind: 'sql' as const, sql: 'SELECT demo_metrics' },
  refresh: { mode: 'cached-ttl' as const, ttlSeconds: 60 },
};

const demoDashboard: Dashboard = {
  title: 'Ingresos y rendimiento',
  description: 'Una lectura rápida de los indicadores que requieren atención esta semana.',
  theme: 'moderno-saas',
  archetype: 'kpi-grid',
  archetypeVariant: {
    density: 'balanced',
    accent: 'default',
    timeWindow: 'last_30d',
    comparativo: 'previous_period',
  },
  widgets: [
    {
      type: 'kpi',
      id: 'demo-revenue',
      position: { col: 1, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: 'Ingresos netos', format: 'currency', showDelta: true },
      data: { value: 128400, delta: 8.4 },
      source: DEMO_DATA_SOURCE,
    },
    {
      type: 'kpi',
      id: 'demo-orders',
      position: { col: 4, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: 'Órdenes', format: 'number', showDelta: true },
      data: { value: 1842, delta: 4.1 },
      source: DEMO_DATA_SOURCE,
    },
    {
      type: 'kpi',
      id: 'demo-conversion',
      position: { col: 7, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: 'Conversión', format: 'percent', showDelta: true },
      data: { value: 6.8, delta: -0.7 },
      source: DEMO_DATA_SOURCE,
    },
    {
      type: 'kpi',
      id: 'demo-aov',
      position: { col: 10, row: 1, colSpan: 3, rowSpan: 1 },
      config: { title: 'Ticket promedio', format: 'currency', showDelta: true },
      data: { value: 69.7, delta: 3.2 },
      source: DEMO_DATA_SOURCE,
    },
    {
      type: 'line-chart',
      id: 'demo-revenue-trend',
      position: { col: 1, row: 2, colSpan: 12, rowSpan: 3 },
      config: { title: 'Ingresos por período', smooth: true, showLegend: true, showGrid: true },
      data: {
        series: [
          {
            name: 'Ingresos',
            data: [
              { x: 'Semana 1', y: 24200 },
              { x: 'Semana 2', y: 28600 },
              { x: 'Semana 3', y: 25400 },
              { x: 'Semana 4', y: 30200 },
            ],
          },
        ],
      },
      source: DEMO_DATA_SOURCE,
    },
  ],
};

export default function DashboardDemoPage() {
  return (
    <main className="min-h-screen bg-background">
      <DashboardGrid dashboard={demoDashboard} />
    </main>
  );
}
