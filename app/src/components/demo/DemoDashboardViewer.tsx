'use client';

import * as React from 'react';
import Link from 'next/link';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { ExportShareDialog } from '@/components/dashboard/ExportShareDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  ArrowRight,
  Palette,
  MessageSquareText,
  CheckCircle2,
  Database,
  Code2,
  Plus,
  X,
  Send,
} from 'lucide-react';
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
    description: 'MRR, Churn, Conversión, Adquisición y Cuentas Clave',
    dashboard: {
      title: 'Mesa de Decisión Ejecutiva — SaaS Analytics',
      description: 'Métricas de crecimiento recurrente, salud de retención y desglose de canales.',
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
          config: { title: 'Ingresos Netos (MRR)', format: 'currency', showDelta: true },
          data: { value: 128400, delta: 12.4 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'kpi',
          id: 'demo-orders',
          position: { col: 4, row: 1, colSpan: 3, rowSpan: 1 },
          config: { title: 'ARR Proyectado', format: 'currency', showDelta: true },
          data: { value: 1540800, delta: 15.2 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'kpi',
          id: 'demo-conversion',
          position: { col: 7, row: 1, colSpan: 3, rowSpan: 1 },
          config: { title: 'Tasa de Churn', format: 'percent', showDelta: true },
          data: { value: 1.8, delta: -0.4 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'kpi',
          id: 'demo-aov',
          position: { col: 10, row: 1, colSpan: 3, rowSpan: 1 },
          config: { title: 'Clientes Activos', format: 'number', showDelta: true },
          data: { value: 2450, delta: 8.1 },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'area-chart',
          id: 'demo-revenue-trend',
          position: { col: 1, row: 2, colSpan: 8, rowSpan: 3 },
          config: { title: 'Evolución de Ingresos y MRR (USD)', smooth: true, showLegend: true, showGrid: true },
          data: {
            series: [
              {
                name: 'MRR Facturado',
                data: [
                  { x: 'Ene', y: 84000 },
                  { x: 'Feb', y: 92500 },
                  { x: 'Mar', y: 101200 },
                  { x: 'Abr', y: 112000 },
                  { x: 'May', y: 119800 },
                  { x: 'Jun', y: 128400 },
                ],
              },
              {
                name: 'MRR Proyectado',
                data: [
                  { x: 'Ene', y: 88000 },
                  { x: 'Feb', y: 96000 },
                  { x: 'Mar', y: 106000 },
                  { x: 'Abr', y: 117000 },
                  { x: 'May', y: 125000 },
                  { x: 'Jun', y: 135000 },
                ],
              },
            ],
          },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'pie-chart',
          id: 'demo-plan-dist',
          position: { col: 9, row: 2, colSpan: 4, rowSpan: 3 },
          config: { title: 'Distribución de MRR por Plan', showLegend: true },
          data: [
            { label: 'Enterprise B2B', value: 68400 },
            { label: 'Pro Scale', value: 42000 },
            { label: 'Starter', value: 18000 },
          ],
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'bar-chart',
          id: 'demo-channels',
          position: { col: 1, row: 5, colSpan: 6, rowSpan: 3 },
          config: { title: 'Nuevas Cuentas por Canal de Adquisición', orientation: 'horizontal', showGrid: true },
          data: {
            categories: ['Orgánico / SEO', 'Outbound B2B', 'Google Ads', 'Referidos'],
            series: [{ name: 'Clientes Nuevos', data: [840, 620, 510, 390] }],
          },
          source: DEMO_DATA_SOURCE,
        },
        {
          type: 'table',
          id: 'demo-accounts',
          position: { col: 7, row: 5, colSpan: 6, rowSpan: 3 },
          config: {
            title: 'Cuentas Enterprise Recientes',
            columns: [
              { key: 'empresa', label: 'Empresa', format: 'text', align: 'left' },
              { key: 'plan', label: 'Plan', format: 'text', align: 'left' },
              { key: 'mrr', label: 'MRR', format: 'currency', align: 'right' },
              { key: 'usuarios', label: 'Seats', format: 'number', align: 'right' },
            ],
          },
          data: [
            { empresa: 'FinTech Andes SpA', plan: 'Enterprise', mrr: 8400, usuarios: 140 },
            { empresa: 'Logística Austral', plan: 'Enterprise', mrr: 5600, usuarios: 95 },
            { empresa: 'Omnichannel Labs', plan: 'Pro Scale', mrr: 3200, usuarios: 50 },
            { empresa: 'CloudScale Global', plan: 'Pro Scale', mrr: 2800, usuarios: 35 },
          ],
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
  const [isNlqaOpen, setIsNlqaOpen] = React.useState<boolean>(true);

  const baseDashboard = DEMO_PRESETS[activePresetKey]?.dashboard ?? DEMO_PRESETS.saas!.dashboard;

  const currentDashboard = React.useMemo<Dashboard>(() => {
    return {
      ...baseDashboard,
      theme: activeTheme,
    };
  }, [baseDashboard, activeTheme]);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Demo Top Navigation */}
      <nav
        aria-label="Navegación de demo"
        className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className="gap-1.5 font-semibold text-primary border-primary/40 bg-primary/10">
            <Sparkles className="w-3.5 h-3.5" /> Modo Demo
          </Badge>

          <div className="flex items-center gap-1 bg-background/90 p-1 rounded-lg border border-border">
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
            className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-background/60 hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
            title="Alternar tema visual"
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Tema: {activeTheme === 'moderno-saas' ? 'Moderno SaaS' : 'Corporate'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNlqaOpen((v) => !v)}
            className={`text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-medium transition-all ${
              isNlqaOpen
                ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                : 'bg-background hover:bg-surface text-foreground border-border'
            }`}
          >
            <MessageSquareText className="w-3.5 h-3.5" />
            <span>Asistente IA (NLQA)</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
            <Database className="w-3.5 h-3.5 text-emerald-500" />
            <span>PostgreSQL RLS + Stripe API</span>
          </div>
          <ExportShareDialog dashboardId="demo" dashboardTitle={currentDashboard.title} />
          <Button asChild size="sm" className="gap-1.5 shadow-xs">
            <Link href="/signup">
              <span>Crear mi dashboard gratis</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </div>
      </nav>

      {/* Main View: Split with Dashboard and AI Assistant */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left / Center: The Decision Desk Dashboard Grid */}
        <main className="flex-1 overflow-y-auto p-2 sm:p-4 md:p-6 transition-all">
          <div className="max-w-[1600px] mx-auto">
            <DashboardGrid dashboard={currentDashboard} />
          </div>
        </main>

        {/* Right: AI NLQA Assistant Panel */}
        {isNlqaOpen && (
          <aside className="w-full lg:w-[440px] xl:w-[480px] border-l border-border bg-card flex flex-col shadow-sm transition-all">
            {/* AI Panel Header */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-surface/50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Asistente IA de Analítica (NLQA)</h3>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <span>Modelo: Anthropic Claude 3.5 Sonnet</span>
                    <span>•</span>
                    <span className="text-emerald-600 font-medium">BYOK Activo</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNlqaOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-surface"
                title="Cerrar panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* AI Conversation Scroll */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* User Question */}
              <div className="flex gap-2.5 justify-end">
                <div className="bg-primary text-primary-foreground p-3 rounded-2xl rounded-tr-xs max-w-[85%] shadow-xs">
                  <p className="leading-relaxed">
                    ¿Cuáles son los 3 planes con mayor crecimiento este trimestre y cómo afectaron al MRR total?
                  </p>
                  <span className="text-[10px] text-primary-foreground/70 block mt-1 text-right">Hoy 16:42</span>
                </div>
              </div>

              {/* Assistant Answer */}
              <div className="flex gap-2.5 items-start">
                <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1 space-y-2.5 bg-surface/70 border border-border/80 p-3.5 rounded-2xl rounded-tl-xs shadow-xs">
                  {/* Security / SQL Verification Badge */}
                  <div className="flex items-center justify-between text-[11px] pb-1.5 border-b border-border/60">
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      SQL Validado (SELECT-only)
                    </span>
                    <span className="text-muted-foreground font-mono">38ms • 3 filas</span>
                  </div>

                  {/* SQL Code Block */}
                  <div className="rounded-lg bg-slate-950 text-slate-100 p-3 font-mono text-[11px] overflow-x-auto shadow-inner">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pb-1 mb-1 border-b border-slate-800">
                      <span className="flex items-center gap-1">
                        <Code2 className="w-3 h-3" /> Query generada automáticamente
                      </span>
                      <span>PostgreSQL 16</span>
                    </div>
                    <pre className="text-slate-200 leading-snug">
{`SELECT 
  plan_name,
  sum(mrr) AS mrr_total,
  round(avg(net_retention), 1) AS ndr
FROM subscriptions
WHERE status = 'active'
GROUP BY plan_name
ORDER BY mrr_total DESC
LIMIT 3;`}
                    </pre>
                  </div>

                  {/* Executive Narrative */}
                  <div className="text-foreground/90 space-y-1.5 leading-relaxed">
                    <p>
                      El segmento <strong className="font-semibold text-foreground">Enterprise B2B</strong> es el
                      principal motor con <strong className="text-foreground">$68.400 USD</strong> en MRR (+24% QoQ),
                      seguido por <strong className="font-semibold text-foreground">Pro Scale</strong> con{' '}
                      <strong className="text-foreground">$42.000 USD</strong>.
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      La tasa de retención neta (NDR) alcanzó el 118%, mitigando la contracción natural del segmento
                      inicial.
                    </p>
                  </div>

                  {/* Save as Widget CTA */}
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Sugerencia: Gráfico circular</span>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10">
                      <Plus className="w-3 h-3" /> Guardar como widget
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Prompt Input Bar */}
            <div className="p-3 border-t border-border bg-card">
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Pregúntale a tus datos (ej: ¿Cuál fue el churn de ayer?)..."
                  className="w-full text-xs rounded-lg border border-border bg-background px-3 py-2.5 pr-9 text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                  defaultValue=""
                />
                <button
                  type="button"
                  className="absolute right-1.5 p-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  title="Enviar pregunta"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-2 overflow-x-auto text-[10px] text-muted-foreground">
                <span className="shrink-0 font-medium">Sugerencias:</span>
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-surface border border-border cursor-pointer hover:text-foreground">
                  Top 5 clientes por LTV
                </span>
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-surface border border-border cursor-pointer hover:text-foreground">
                  Desglose de churn
                </span>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
