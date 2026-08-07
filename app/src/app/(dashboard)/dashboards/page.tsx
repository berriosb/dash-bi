'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard,
  Sparkles,
  Plus,
  Search,
  Calendar,
  BarChart3,
  ArrowRight,
  Inbox,
} from 'lucide-react';
import { TemplatePicker } from '@/components/templates/TemplatePicker';

interface DashboardListItem {
  id: string;
  title: string;
  description: string | null;
  theme: 'moderno-saas' | 'corporate';
  widgets: unknown[];
  archetype: string;
  updatedAt: string;
}

async function fetchDashboards(): Promise<DashboardListItem[]> {
  const res = await fetch('/api/dashboards');
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  }
  const data = await res.json();
  return data.dashboards as DashboardListItem[];
}

async function fetchDataSources(): Promise<Array<{ id: string; name: string; type: string }>> {
  const res = await fetch('/api/data-sources');
  if (!res.ok) return [];
  const data = await res.json();
  return data.dataSources ?? [];
}

function DashboardsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [showAiModal, setShowAiModal] = useState(searchParams.get('create') === 'ai');
  const [prompt, setPrompt] = useState('');
  const [selectedDataSourceId, setSelectedDataSourceId] = useState('');

  const { data: dashboards = [], isLoading, error } = useQuery({
    queryKey: ['dashboards'],
    queryFn: fetchDashboards,
  });
  const { data: dataSources = [] } = useQuery({
    queryKey: ['data-sources'],
    queryFn: fetchDataSources,
  });

  const filteredDashboards = dashboards.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      (d.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const generate = useMutation({
    mutationFn: async (input: { prompt: string; dataSourceId: string }) => {
      const res = await fetch('/api/dashboards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? err?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      const id = (data?.dashboard as { id?: string })?.id ?? data?.id;
      if (typeof id === 'string') {
        router.push(`/dashboards/${id}`);
      } else {
        router.push('/dashboards');
      }
    },
  });

  const handleGenerateWithAi = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !selectedDataSourceId) return;
    generate.mutate({ prompt, dataSourceId: selectedDataSourceId });
  };

  const [activeTab, setActiveTab] = useState<'my-dashboards' | 'templates'>('my-dashboards');

  return (
    <div className="platform-page platform-page--dashboards">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="platform-page__eyebrow">Analizar</p>
          <h1 className="platform-page__title">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Dashboards
          </h1>
          <p className="platform-page__description">
            Abre una lectura existente o crea una nueva a partir de tus datos reales.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => setShowAiModal(true)}
            data-testid="create-with-ai"
            className="gap-1.5"
            disabled={dataSources.length === 0}
          >
            <Sparkles className="w-4 h-4" />
            <span>Crear con IA</span>
          </Button>

          <Button
            variant="outline"
            onClick={() => router.push('/dashboards/new')}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Manual</span>
          </Button>
        </div>
      </div>

      <div className="platform-tabs" role="tablist" aria-label="Contenido de dashboards">
        <Button
          variant={activeTab === 'my-dashboards' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('my-dashboards')}
          className="platform-tab"
          role="tab"
          aria-selected={activeTab === 'my-dashboards'}
        >
          Mis Dashboards ({dashboards.length})
        </Button>
        <Button
          variant={activeTab === 'templates' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('templates')}
          className="platform-tab gap-1.5"
          role="tab"
          aria-selected={activeTab === 'templates'}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Plantillas por Industria</span>
        </Button>
      </div>

      {activeTab === 'templates' ? (
        <TemplatePicker />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="platform-search-field">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Buscar dashboards por título o descripción..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-9"
              />
            </div>
          </div>

      {isLoading && <p className="text-slate-400 text-sm">Cargando dashboards…</p>}

      {error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          No pudimos cargar tus dashboards. Reintentá en unos segundos.
        </div>
      )}

      {!isLoading && dashboards.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
          <Inbox className="w-8 h-8 text-slate-500 mx-auto mb-3" />
          <h2 className="text-sm font-semibold text-white">Todavía no tenés dashboards</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Empezá generando uno con IA a partir de tu fuente de datos, o creá uno manualmente.
          </p>
          <Button
            onClick={() => setShowAiModal(true)}
            disabled={dataSources.length === 0}
            className="mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-4 h-9 gap-1.5"
          >
            <Sparkles className="w-4 h-4" />
            <span>Crear mi primer dashboard</span>
          </Button>
        </div>
      )}

      {dashboards.length > 0 && (
          <div className="platform-dashboard-list">
          {filteredDashboards.map((dash) => (
            <Card
              key={dash.id}
              data-testid={`dashboard-card-${dash.id}`}
              className="platform-dashboard-item group flex flex-col justify-between"
            >
              <CardHeader className="platform-dashboard-item__header">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="platform-dashboard-item__title">
                    {dash.title}
                  </CardTitle>
                  {dash.archetype !== 'custom' && (
                    <Badge variant="secondary" className="platform-dashboard-item__badge">
                      Generado
                    </Badge>
                  )}
                </div>
                <CardDescription className="platform-dashboard-item__description line-clamp-2">
                  {dash.description ?? 'Sin descripción'}
                </CardDescription>
              </CardHeader>

              <CardContent className="platform-dashboard-item__content">
                <div className="platform-dashboard-item__meta">
                  <span className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" />
                    {Array.isArray(dash.widgets) ? dash.widgets.length : 0} widgets
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(dash.updatedAt).toLocaleDateString()}
                  </span>
                </div>

                <Link
                  href={`/dashboards/${dash.id}`}
                  className="platform-dashboard-item__action"
                >
                  <span>Ver Dashboard</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </>
      )}

      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-lg bg-slate-900 border-slate-800 text-white shadow-2xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <span>Generar Dashboard con IA</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Escribí lo que querés visualizar. Seleccioná la fuente de datos y la IA arma el dashboard.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleGenerateWithAi} className="space-y-4">
                <div>
                  <label htmlFor="ds-select" className="text-xs text-slate-300 block mb-1">
                    Fuente de datos
                  </label>
                  <select
                    id="ds-select"
                    data-testid="ai-datasource-select"
                    value={selectedDataSourceId}
                    onChange={(e) => setSelectedDataSourceId(e.target.value)}
                    required
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">— Seleccioná una fuente —</option>
                    {dataSources.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name} ({ds.type})
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  rows={4}
                  data-testid="ai-prompt"
                  placeholder="Ej: Mostrame un resumen de métricas clave de Stripe con MRR, clientes nuevos y porcentaje de cancelación..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />

                {generate.isError && (
                  <p className="text-xs text-red-300">
                    {(generate.error as Error).message}
                  </p>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAiModal(false)}
                    className="text-slate-400 hover:text-white text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={generate.isPending || !selectedDataSourceId || !prompt.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-4"
                  >
                    {generate.isPending ? 'Generando...' : 'Generar dashboard'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function DashboardsPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Cargando…</div>}>
      <DashboardsContent />
    </Suspense>
  );
}
