'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { DashboardControls } from '@/components/dashboard/DashboardControls';
import { DashboardStatusBar } from '@/components/dashboard/DashboardStatusBar';
import { PropertyPanel } from '@/components/properties/PropertyPanel';
import { AddWidgetDialog } from '@/components/widgets/dialogs/AddWidgetDialog';
import { ExportShareDialog } from '@/components/dashboard/ExportShareDialog';
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
  const rawId = params?.id;
  const dashboardId: string = typeof rawId === 'string' ? rawId : (Array.isArray(rawId) && rawId[0] ? rawId[0] : 'demo');
  const { isEditing, setEditMode, activeTheme, setActiveTheme, selectedWidgetId, setSelectedWidgetId, isNlqaOpen, toggleNlqa } = useUIStore();
  const { toast } = useToast();

  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const updateArchetype = useDashboardStore((s) => s.updateArchetype);
  // Sprint 1.5 fix: wrap the aggregate selector in `useShallow` so
  // individual field updates don't return a brand-new object literal
  // on every render. Without this, the default `Object.is` equality
  // fails on the new object reference and zustand triggers a
  // re-render, which fires the useEffects below, which call
  // `setDashboard` and invalidate the `['dashboard', id]` query,
  // producing the "Maximum update depth" infinite loop observed in
  // CI (`dashboardGrid` test, Chromium project).
  const storeState = useDashboardStore(
    useShallow((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      theme: s.theme,
      widgets: s.widgets,
      archetype: s.archetype,
      archetypeVariant: s.archetypeVariant,
    })),
  );
  const dashboardGridRef = useRef<HTMLDivElement>(null);

  const { data: remoteDashboard, isLoading, error } = useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => fetchDashboard(dashboardId),
    enabled: dashboardId !== 'demo',
    retry: 1,
  });

  const dashboard: Dashboard = useMemo(
    () => ({
      title: isEditing ? storeState.title : (remoteDashboard?.title ?? storeState.title),
      description: isEditing ? storeState.description : (remoteDashboard?.description ?? storeState.description),
      theme: isEditing ? storeState.theme : (remoteDashboard?.theme ?? storeState.theme),
      widgets: isEditing ? storeState.widgets : (remoteDashboard?.widgets ?? storeState.widgets),
      archetype: isEditing ? storeState.archetype : (remoteDashboard?.archetype ?? storeState.archetype),
      archetypeVariant: isEditing ? storeState.archetypeVariant : (remoteDashboard?.archetypeVariant ?? storeState.archetypeVariant),
    }),
    [
      isEditing,
      remoteDashboard,
      storeState.title,
      storeState.description,
      storeState.theme,
      storeState.widgets,
      storeState.archetype,
      storeState.archetypeVariant,
    ],
  );

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

  const showPropertyPanel = isEditing && selectedWidgetId !== null;
  const layoutClass = useMemo(
    () => `platform-editor-page ${showPropertyPanel ? 'dashboard-detail-layout-wrapper' : ''}`,
    [showPropertyPanel],
  );

  return (
    <div className={layoutClass}>
      <div className="platform-editor-header">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/dashboards')}
            className="platform-editor-back"
            aria-label="Volver al listado"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="platform-editor-title">{dashboard.title}</h1>
              <Badge variant="outline" className="platform-editor-theme-badge">
                {activeTheme === 'moderno-saas' ? 'Tema Moderno' : 'Tema Corporate'}
              </Badge>
              <DashboardStatusBar status={status} isEditing={isEditing} />
            </div>
            <p className="platform-editor-description">{dashboard.description}</p>
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
                className="platform-editor-icon-action"
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
                className="platform-editor-icon-action"
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
            onClick={toggleNlqa}
            aria-pressed={isNlqaOpen}
            aria-label="Abrir chat con datos"
            className="platform-editor-action text-xs gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
            Preguntar
          </Button>

          <ExportShareDialog
            dashboardId={dashboardId}
            dashboardTitle={dashboard.title}
            targetRef={dashboardGridRef}
          />

          <Button
            size="sm"
            onClick={handleToggleEdit}
            className={
              isEditing
                ? 'platform-editor-finish text-xs gap-1.5'
                : 'platform-editor-primary text-xs gap-1.5'
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

      <div className="dashboard-detail-layout" ref={dashboardGridRef}>
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
