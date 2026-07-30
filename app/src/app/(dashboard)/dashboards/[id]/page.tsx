'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { DashboardControls } from '@/components/dashboard/DashboardControls';
import { DashboardStatusBar } from '@/components/dashboard/DashboardStatusBar';
import { PropertyPanel } from '@/components/properties/PropertyPanel';
import { AddWidgetDialog } from '@/components/widgets/dialogs/AddWidgetDialog';
import { NlqaPanel } from '@/components/nlqa/NlqaPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useAutoSave } from '@/hooks/use-auto-save';
import { useUndoRedo, useDashboardKeyboardShortcuts } from '@/hooks/use-undo-redo';
import { useToast } from '@/hooks/use-toast';
import type { Dashboard, ArchetypeId, ArchetypeVariant } from '@/lib/widgets/types';
import {
  ArrowLeft,
  Edit3,
  Eye,
  Download,
  Share2,
  Undo2,
  Redo2,
  MessageSquare,
} from 'lucide-react';

async function fetchDashboard(id: string): Promise<Dashboard> {
  const res = await fetch(`/api/dashboards/${id}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err?.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  const data = await res.json();
  // The backend stores archetype + variant as top-level columns; fold
  // them into the Dashboard shape so callers see a single object.
  const d = data.dashboard as Dashboard & {
    archetype?: ArchetypeId;
    archetypeVariant?: ArchetypeVariant;
  };
  return {
    title: d.title,
    description: d.description,
    theme: d.theme,
    widgets: d.widgets,
    archetype: d.archetype ?? 'custom',
    archetypeVariant: d.archetypeVariant,
  };
}

export default function DashboardDetailPage() {
  const router = useRouter();
  const params = useParams();
  const dashboardId = (params?.id as string) ?? 'demo';
  const { isEditing, setEditMode, activeTheme, setActiveTheme, selectedWidgetId, setSelectedWidgetId, isNlqaOpen, toggleNlqa } = useUIStore();
  const { toast } = useToast();

  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const updateArchetype = useDashboardStore((s) => s.updateArchetype);
  const storeState = useDashboardStore((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    theme: s.theme,
    widgets: s.widgets,
    archetype: s.archetype,
    archetypeVariant: s.archetypeVariant,
  }));
  const dashboard: Dashboard = useMemo(
    () => ({
      title: storeState.title,
      description: storeState.description,
      theme: storeState.theme,
      widgets: storeState.widgets,
      archetype: storeState.archetype,
      archetypeVariant: storeState.archetypeVariant,
    }),
    [
      storeState.title,
      storeState.description,
      storeState.theme,
      storeState.widgets,
      storeState.archetype,
      storeState.archetypeVariant,
    ],
  );

  const [copiedShare, setCopiedShare] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const { data: remoteDashboard, isLoading, error } = useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => fetchDashboard(dashboardId),
    enabled: dashboardId !== 'demo',
    retry: 1,
  });

  useEffect(() => {
    if (!remoteDashboard) return;
    setDashboard({
      id: dashboardId,
      title: remoteDashboard.title,
      description: remoteDashboard.description ?? '',
      theme: remoteDashboard.theme,
      widgets: remoteDashboard.widgets,
      archetype: remoteDashboard.archetype ?? 'custom',
      archetypeVariant: remoteDashboard.archetypeVariant,
    });
    setActiveTheme(remoteDashboard.theme);
  }, [remoteDashboard, dashboardId, setDashboard, setActiveTheme]);

  const { trigger, status, flush } = useAutoSave(dashboardId);
  const { undo, redo, canUndo, canRedo } = useUndoRedo();
  useDashboardKeyboardShortcuts();

  useEffect(() => {
    if (!isEditing) return;
    const serialized: Dashboard = {
      title: dashboard.title,
      description: dashboard.description,
      theme: dashboard.theme,
      widgets: dashboard.widgets,
      archetype: dashboard.archetype,
      archetypeVariant: dashboard.archetypeVariant,
    };
    trigger(serialized);
  }, [
    isEditing,
    dashboard.title,
    dashboard.description,
    dashboard.theme,
    dashboard.widgets,
    dashboard.archetype,
    dashboard.archetypeVariant,
    trigger,
  ]);

  // Derive the primary data source from the first widget (dashboards have
  // at most a few data sources; for MVP we use the first one). Better: fetch
  // the full dataSource list separately in a future Sprint.
  const primaryDataSourceId =
    storeState.widgets.find((w) => w.source?.dataSourceId)?.source?.dataSourceId ?? undefined;

  const handleToggleEdit = () => {
    if (isEditing) flush();
    setEditMode(!isEditing);
    if (isEditing) setSelectedWidgetId(null);
    toast({
      title: isEditing ? 'Edición finalizada' : 'Modo edición activo',
      description: isEditing
        ? 'Volviste al modo lectura.'
        : 'Mové widgets y editá configuración. Los cambios se guardan automáticamente.',
    });
  };

  const handleThemeChange = (next: typeof activeTheme) => {
    setActiveTheme(next);
    setDashboard({
      id: storeState.id ?? undefined,
      title: dashboard.title,
      description: dashboard.description,
      theme: next,
      widgets: dashboard.widgets,
      archetype: dashboard.archetype,
      archetypeVariant: dashboard.archetypeVariant,
    });
    toast({
      title: `Tema ${next === 'moderno-saas' ? 'Moderno SaaS' : 'Corporate'}`,
      description: 'El cambio se ve de inmediato en todos los widgets.',
    });
  };

  const handleArchetypeChange = (next: ArchetypeId) => {
    updateArchetype(next);
    toast({
      title: `Disposición ${next}`,
      description:
        next === 'custom'
          ? 'Mantuviste la disposición actual.'
          : 'Los widgets se reorganizan al patrón del archetype.',
    });
  };

  const handleShareLink = async () => {
    try {
      const shareUrl = `${window.location.origin}/share/pub_${dashboardId}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      toast({ title: 'Enlace copiado', description: shareUrl });
      setTimeout(() => setCopiedShare(false), 2500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al copiar';
      toast({ variant: 'destructive', title: 'No pudimos copiar', description: message });
    }
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/export/pdf`, { method: 'POST' });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${dashboard.title}.pdf`;
        a.click();
        toast({ title: 'PDF generado', description: 'La descarga empezó automáticamente.' });
      } else {
        toast({ title: 'Generación de PDF encolada', description: 'Te avisamos cuando esté lista (Sprint 5).' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al exportar';
      toast({ variant: 'destructive', title: 'No pudimos exportar', description: message });
    } finally {
      setIsExporting(false);
    }
  };

  const showPropertyPanel = isEditing && selectedWidgetId !== null;
  const layoutClass = useMemo(
    () => `space-y-6 ${showPropertyPanel ? 'dashboard-detail-layout-wrapper' : ''}`,
    [showPropertyPanel],
  );

  return (
    <div className={layoutClass}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/dashboards')}
            className="text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Volver al listado"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold tracking-tight text-white">{dashboard.title}</h1>
              <Badge variant="outline" className="text-[10px] border-slate-700 text-indigo-400">
                {activeTheme === 'moderno-saas' ? 'Tema Moderno' : 'Tema Corporate'}
              </Badge>
              <DashboardStatusBar status={status} isEditing={isEditing} />
            </div>
            <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">{dashboard.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isEditing && (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Deshacer (Ctrl+Z)"
                title="Deshacer (Ctrl+Z)"
                className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Rehacer (Ctrl+Shift+Z)"
                title="Rehacer (Ctrl+Shift+Z)"
                className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </Button>
              <AddWidgetDialog dashboardId={dashboardId} />
            </>
          )}

          {isEditing && (
            <DashboardControls
              theme={activeTheme}
              archetype={dashboard.archetype ?? 'custom'}
              onThemeChange={handleThemeChange}
              onArchetypeChange={handleArchetypeChange}
            />
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleShareLink}
            className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs gap-1.5"
          >
            {copiedShare ? <span>¡Enlace copiado!</span> : <><Share2 className="w-3.5 h-3.5" /> Compartir</>}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={toggleNlqa}
            aria-pressed={isNlqaOpen}
            aria-label="Abrir chat con datos"
            className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
            Preguntar
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={isExporting}
            className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting ? 'Exportando...' : 'Exportar PDF'}
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

      {error && !isLoading && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          No pudimos cargar este dashboard desde el servidor. Estás viendo datos de demo locales.
        </div>
      )}

      <div className="dashboard-detail-layout">
        <DashboardGrid
          dashboard={{ ...dashboard, theme: activeTheme }}
          isEditing={isEditing}
        />
        {showPropertyPanel && <PropertyPanel dashboardId={dashboardId} />}
      </div>

      <NlqaPanel
        dashboardId={dashboardId}
        dataSourceId={primaryDataSourceId}
        open={isNlqaOpen}
        onClose={() => toggleNlqa()}
      />
    </div>
  );
}