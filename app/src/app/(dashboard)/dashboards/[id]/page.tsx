'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { Dashboard, DEFAULT_VARIANT } from '@/lib/widgets/types';
import {
  ArrowLeft,
  Edit3,
  Eye,
  Download,
  Share2,
  Palette,
  Check,
} from 'lucide-react';

const mockDashboard: Dashboard = {
  title: 'Ventas & KPI Ejecutivos 2026',
  description: 'Resumen en tiempo real de ingresos recurrentes, conversión de pasarelas y retención por cohorte',
  theme: 'moderno-saas',
  archetype: 'executive-summary',
  archetypeVariant: DEFAULT_VARIANT,
  widgets: [
    {
      id: 'w_kpi_mrr',
      type: 'kpi',
      position: { col: 1, colSpan: 3, row: 1, rowSpan: 2 },
      config: { title: 'MRR Total (Ingreso Mensual)', format: 'currency', showDelta: true },
      data: { value: 124500, previousValue: 108400, delta: 14.8 },
      source: { kind: 'query', dataSourceId: 'ds_postgres_prod', query: { kind: 'sql', sql: 'SELECT SUM(amount) FROM subs' } },
    },
    {
      id: 'w_kpi_churn',
      type: 'kpi',
      position: { col: 4, colSpan: 3, row: 1, rowSpan: 2 },
      config: { title: 'Tasa de Cancelación (Churn)', format: 'percent', showDelta: true },
      data: { value: 2.1, previousValue: 2.7, delta: -0.6 },
      source: { kind: 'query', dataSourceId: 'ds_postgres_prod', query: { kind: 'sql', sql: 'SELECT churn FROM metrics' } },
    },
    {
      id: 'w_kpi_customers',
      type: 'kpi',
      position: { col: 7, colSpan: 3, row: 1, rowSpan: 2 },
      config: { title: 'Clientes Activos', format: 'number', showDelta: true },
      data: { value: 1540, previousValue: 1420, delta: 8.4 },
      source: { kind: 'query', dataSourceId: 'ds_postgres_prod', query: { kind: 'sql', sql: 'SELECT COUNT(*) FROM users' } },
    },
    {
      id: 'w_kpi_arpu',
      type: 'kpi',
      position: { col: 10, colSpan: 3, row: 1, rowSpan: 2 },
      config: { title: 'ARPU Promedio', format: 'currency' },
      data: { value: 80.8, previousValue: 78.3, delta: 3.1 },
      source: { kind: 'query', dataSourceId: 'ds_postgres_prod', query: { kind: 'sql', sql: 'SELECT arpu FROM metrics' } },
    },
    {
      id: 'w_chart_mrr_trend',
      type: 'area-chart',
      position: { col: 1, colSpan: 8, row: 3, rowSpan: 5 },
      config: { title: 'Evolución de Ingresos Recurrentes (MRR)', showGrid: true, smooth: true },
      data: [
        { label: 'Ene', value: 85000 },
        { label: 'Feb', value: 92000 },
        { label: 'Mar', value: 98000 },
        { label: 'Abr', value: 105000 },
        { label: 'May', value: 114000 },
        { label: 'Jun', value: 124500 },
      ],
      source: { kind: 'query', dataSourceId: 'ds_postgres_prod', query: { kind: 'sql', sql: 'SELECT month, mrr FROM mrr_history' } },
    },
    {
      id: 'w_chart_pie_plans',
      type: 'pie-chart',
      position: { col: 9, colSpan: 4, row: 3, rowSpan: 5 },
      config: { title: 'Distribución por Plan', variant: 'donut' },
      data: [
        { label: 'Starter', value: 450 },
        { label: 'Pro', value: 820 },
        { label: 'Enterprise', value: 270 },
      ],
      source: { kind: 'query', dataSourceId: 'ds_postgres_prod', query: { kind: 'sql', sql: 'SELECT plan, count FROM plan_dist' } },
    },
  ],
};

export default function DashboardDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { isEditing, setEditMode, activeTheme, setActiveTheme } = useUIStore();

  const [dashboard, setDashboard] = useState<Dashboard>(mockDashboard);
  const [copiedShare, setCopiedShare] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleToggleEdit = () => {
    setEditMode(!isEditing);
  };

  const handleThemeChange = () => {
    const nextTheme = activeTheme === 'moderno-saas' ? 'corporate' : 'moderno-saas';
    setActiveTheme(nextTheme);
    setDashboard((prev) => ({ ...prev, theme: nextTheme }));
  };

  const handleShareLink = async () => {
    try {
      const shareUrl = `${window.location.origin}/share/pub_${params.id || 'demo'}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    } catch {
      alert('Enlace copiado al portapapeles');
    }
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/dashboards/${params.id}/export/pdf`, {
        method: 'POST',
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${dashboard.title}.pdf`;
        a.click();
      } else {
        alert('Generación de PDF solicitada a worker.');
      }
    } catch {
      alert('Generación de PDF solicitada a worker.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Toolbar Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/dashboards')}
            className="text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-white">{dashboard.title}</h1>
              <Badge variant="outline" className="text-[10px] border-slate-700 text-indigo-400">
                {activeTheme === 'moderno-saas' ? 'Tema Moderno' : 'Tema Corporate'}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">{dashboard.description}</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleThemeChange}
            className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs gap-1.5"
          >
            <Palette className="w-3.5 h-3.5 text-purple-400" />
            <span>Alternar Tema</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleShareLink}
            className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs gap-1.5"
          >
            {copiedShare ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-indigo-400" />}
            <span>{copiedShare ? '¡Enlace Copiado!' : 'Compartir'}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={isExporting}
            className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-pink-400" />
            <span>{isExporting ? 'Exportando...' : 'Exportar PDF'}</span>
          </Button>

          <Button
            size="sm"
            onClick={handleToggleEdit}
            className={
              isEditing
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs gap-1.5'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs gap-1.5'
            }
          >
            {isEditing ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Finalizar Edición</span>
              </>
            ) : (
              <>
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar Dashboard</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main Grid Surface */}
      <DashboardGrid
        dashboard={{ ...dashboard, theme: activeTheme }}
        isEditing={isEditing}
        onLayoutChange={(newWidgets) => {
          setDashboard((prev) => ({ ...prev, widgets: newWidgets }));
        }}
      />
    </div>
  );
}
