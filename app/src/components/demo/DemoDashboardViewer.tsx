'use client';

import * as React from 'react';
import Link from 'next/link';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { ExportShareDialog } from '@/components/dashboard/ExportShareDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ArrowRight, Palette } from 'lucide-react';
import type { Dashboard, ThemeId } from '@/lib/widgets/types';

const DEMO_DATA_SOURCE = {
  kind: 'query' as const,
  dataSourceId: 'demo-source',
  query: { kind: 'sql' as const, sql: 'SELECT demo_metrics' },
  refresh: { mode: 'cached-ttl' as const, ttlSeconds: 60 },
};

export const DEMO_PRESETS: Record<string, { label: string; description: string; dashboard: Dashboard }> = {
  saas: {
    label: 'SaaS / Recurrente',
    description: 'MRR, Churn, Conversión y Ticket Promedio',
    dashboard: {
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
    },
  },
  ecommerce: {
    label: 'E-commerce / Retail',
    description: 'Ventas brutas, pedidos, categorías y top productos',
    dashboard: {
      title: 'Ventas y Operaciones E-commerce',
      description: 'Monitoreo de pedidos, conversión del checkout y productos destacados.',
      theme: 'moderno-saas',
      archetype: 'hero-focus',
      archetypeVariant: {
        density: 'balanced',
        accent: 'default',
        timeWindow: 'last_30d',
        comparativo: 'previous_period',
      },
      widgets: [
        {
          type: 'kpi',
          id: 'demo-ecom-sales',
          position: { col: 1, row: 1, colSpan: 6, rowSpan: 1 },
          config: { title: 'Ventas Totales del Mes', format: 'currency', showDelta: true },
          data: { value: 45890000, delta: 14.2 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'kpi',
          id: 'demo-ecom-orders',
          position: { col: 7, row: 1, colSpan: 3, rowSpan: 1 },
          config: { title: 'Pedidos Entregados', format: 'number', showDelta: true },
          data: { value: 1240, delta: 6.5 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'kpi',
          id: 'demo-ecom-repurchase',
          position: { col: 10, row: 1, colSpan: 3, rowSpan: 1 },
          config: { title: 'Tasa de Recompra', format: 'percent', showDelta: true },
          data: { value: 28.4, delta: 2.1 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'bar-chart',
          id: 'demo-ecom-categories',
          position: { col: 1, row: 2, colSpan: 6, rowSpan: 3 },
          config: { title: 'Ventas por Categoría', orientation: 'horizontal', showGrid: true },
          data: {
            categories: ['Electrónica', 'Hogar', 'Moda', 'Deportes'],
            series: [{ name: 'Ventas', data: [18500000, 12400000, 8900000, 6090000] }],
          },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'table',
          id: 'demo-ecom-top-products',
          position: { col: 7, row: 2, colSpan: 6, rowSpan: 3 },
          config: {
            title: 'Top Productos del Mes',
            columns: [
              { key: 'producto', label: 'Producto', format: 'text', align: 'left' },
              { key: 'unidades', label: 'Unidades', format: 'number', align: 'right' },
              { key: 'ingresos', label: 'Ingresos', format: 'currency', align: 'right' },
            ],
          },
          data: [
            { producto: 'Auriculares Pro Wireless', unidades: 342, ingresos: 8550000 },
            { producto: 'Smartwatch Serie 5', unidades: 210, ingresos: 6300000 },
            { producto: 'Mochila Urbana Waterproof', unidades: 188, ingresos: 3760000 },
            { producto: 'Teclado Mecánico RGB', unidades: 156, ingresos: 3120000 },
          ],
          source: DEMO_DATA_SOURCE,
        },
      ],
    },
  },
  agency: {
    label: 'Agencia / Marketing',
    description: 'Inversión publicitaria, leads y rendimiento por canal',
    dashboard: {
      title: 'Rendimiento de Marketing y Clientes',
      description: 'Retorno de inversión (ROAS), costo por lead y captación omnicanal.',
      theme: 'corporate',
      archetype: 'growth-metrics',
      archetypeVariant: {
        density: 'balanced',
        accent: 'default',
        timeWindow: 'last_30d',
        comparativo: 'previous_period',
      },
      widgets: [
        {
          type: 'kpi',
          id: 'demo-agency-adspend',
          position: { col: 1, row: 1, colSpan: 4, rowSpan: 1 },
          config: { title: 'Inversión Publicitaria', format: 'currency', showDelta: true },
          data: { value: 6500000, delta: -5.2 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'kpi',
          id: 'demo-agency-leads',
          position: { col: 5, row: 1, colSpan: 4, rowSpan: 1 },
          config: { title: 'Leads Calificados (MQL)', format: 'number', showDelta: true },
          data: { value: 890, delta: 18.3 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'kpi',
          id: 'demo-agency-roas',
          position: { col: 9, row: 1, colSpan: 4, rowSpan: 1 },
          config: { title: 'ROAS Global', format: 'number', showDelta: true },
          data: { value: 4.8, delta: 0.6 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'area-chart',
          id: 'demo-agency-leads-trend',
          position: { col: 1, row: 2, colSpan: 12, rowSpan: 3 },
          config: { title: 'Evolución de Leads por Canal', smooth: true, showLegend: true, showGrid: true },
          data: {
            series: [
              {
                name: 'Google Ads',
                data: [
                  { x: 'Sem 1', y: 120 },
                  { x: 'Sem 2', y: 145 },
                  { x: 'Sem 3', y: 180 },
                  { x: 'Sem 4', y: 210 },
                ],
              },
              {
                name: 'Meta Ads',
                data: [
                  { x: 'Sem 1', y: 95 },
                  { x: 'Sem 2', y: 110 },
                  { x: 'Sem 3', y: 130 },
                  { x: 'Sem 4', y: 145 },
                ],
              },
            ],
          },
          source: DEMO_DATA_SOURCE,
        },
      ],
    },
  },
};

export function DemoDashboardViewer() {
  const [activePresetKey, setActivePresetKey] = React.useState<string>('saas');
  const [activeTheme, setActiveTheme] = React.useState<ThemeId>('moderno-saas');

  const baseDashboard = DEMO_PRESETS[activePresetKey]?.dashboard ?? DEMO_PRESETS.saas!.dashboard;

  const currentDashboard = React.useMemo<Dashboard>(() => {
    return {
      ...baseDashboard,
      theme: activeTheme,
    };
  }, [baseDashboard, activeTheme]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Demo Banner */}
      <nav aria-label="Navegación de demo" className="sticky top-0 z-30 border-b border-border/80 bg-surface/95 backdrop-blur px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className="gap-1 font-semibold text-primary border-primary/40 bg-primary/10">
            <Sparkles className="w-3.5 h-3.5" /> Modo Demo
          </Badge>

          <div className="flex items-center gap-1 bg-background/80 p-1 rounded-lg border border-border/60">
            {Object.entries(DEMO_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setActivePresetKey(key);
                  setActiveTheme(preset.dashboard.theme ?? 'moderno-saas');
                }}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  activePresetKey === key
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setActiveTheme((t) => (t === 'moderno-saas' ? 'corporate' : 'moderno-saas'))}
            className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/60 bg-background/60 hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
            title="Alternar tema visual"
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Tema: {activeTheme === 'moderno-saas' ? 'Moderno' : 'Corporate'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <ExportShareDialog dashboardId="demo" dashboardTitle={currentDashboard.title} />
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/signup">
              <span>Crear mi dashboard gratis</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </div>
      </nav>

      {/* Dashboard View */}
      <main className="flex-1 bg-background">
        <DashboardGrid dashboard={currentDashboard} />
      </main>
    </div>
  );
}
