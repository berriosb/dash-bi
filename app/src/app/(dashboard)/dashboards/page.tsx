'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LayoutDashboard, Sparkles, Plus, Search, Calendar, BarChart3, Layers, ArrowRight } from 'lucide-react';

interface DashboardItem {
  id: string;
  title: string;
  description: string;
  theme: 'moderno-saas' | 'corporate';
  widgetCount: number;
  updatedAt: string;
  generatedByAi?: boolean;
}

const mockDashboards: DashboardItem[] = [
  {
    id: 'dash_sales_2026',
    title: 'Ventas & KPI Ejecutivos 2026',
    description: 'Resumen mensual de ingresos MRR, conversión de Stripe y churn rate',
    theme: 'moderno-saas',
    widgetCount: 5,
    updatedAt: 'Hace 10 min',
    generatedByAi: true,
  },
  {
    id: 'dash_user_churn',
    title: 'Análisis de Usuarios y Retención',
    description: 'Cohortes de usuarios activos diarios (DAU/MAU) y embudo de registro',
    theme: 'corporate',
    widgetCount: 4,
    updatedAt: 'Ayer',
    generatedByAi: true,
  },
  {
    id: 'dash_postgres_prod',
    title: 'Monitoreo Base de Datos PostgreSQL',
    description: 'Queries lentas, uso de almacenamiento y conexiones activas por tenant',
    theme: 'moderno-saas',
    widgetCount: 6,
    updatedAt: 'Hace 3 días',
  },
];

export default function DashboardsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [showAiModal, setShowAiModal] = useState(searchParams.get('create') === 'ai');
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const filteredDashboards = mockDashboards.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleGenerateWithAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsGenerating(true);
    try {
      const res = await fetch('/api/dashboards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();
      if (data.id) {
        router.push(`/dashboards/${data.id}`);
      } else {
        router.push(`/dashboards/dash_sales_2026`);
      }
    } catch {
      router.push(`/dashboards/dash_sales_2026`);
    } finally {
      setIsGenerating(false);
      setShowAiModal(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-indigo-400" />
            <span>Dashboards</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Explorá tus tableros de control y generá nuevos resúmenes ejecutivos con IA.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => setShowAiModal(true)}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium text-xs px-4 h-9 shadow-lg shadow-indigo-500/20 gap-1.5"
          >
            <Sparkles className="w-4 h-4" />
            <span>Crear con IA ✨</span>
          </Button>

          <Button
            variant="outline"
            onClick={() => router.push('/dashboards/new')}
            className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs h-9 gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Manual</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-slate-900/60 border-slate-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Total Dashboards</p>
              <p className="text-2xl font-extrabold text-white mt-1">3</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-slate-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Widgets Activos</p>
              <p className="text-2xl font-extrabold text-white mt-1">15</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-slate-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Generaciones por IA</p>
              <p className="text-2xl font-extrabold text-white mt-1">12</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Buscar dashboards por título o descripción..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-900/80 border-slate-800 text-white placeholder:text-slate-500 text-xs h-9"
          />
        </div>
      </div>

      {/* Grid of Dashboards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredDashboards.map((dash) => (
          <Card
            key={dash.id}
            className="bg-slate-900/70 border-slate-800/80 hover:border-indigo-500/40 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/5 group flex flex-col justify-between"
          >
            <CardHeader className="p-5 pb-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base font-bold text-white group-hover:text-indigo-400 transition leading-snug">
                  {dash.title}
                </CardTitle>
                {dash.generatedByAi && (
                  <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px]">
                    ✨ IA
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                {dash.description}
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 pt-3 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-800/80 pt-3">
                <span className="flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-slate-400" />
                  {dash.widgetCount} widgets
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  {dash.updatedAt}
                </span>
              </div>

              <Link
                href={`/dashboards/${dash.id}`}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white font-medium text-xs transition group-hover:bg-indigo-600"
              >
                <span>Ver Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* AI Generator Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-lg bg-slate-900 border-slate-800 text-white shadow-2xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <span>Generar Dashboard con IA</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Escribí lo que querés visualizar. Ejemplo: "Quiero ver las ventas mensuales por país y el top 5 de productos vendidos este trimestre".
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleGenerateWithAi} className="space-y-4">
                <textarea
                  rows={4}
                  placeholder="Ej: Mostrame un resumen de métricas clave de Stripe con MRR, clientes nuevos y porcentaje de cancelación..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />

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
                    disabled={isGenerating}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-4"
                  >
                    {isGenerating ? 'Generando...' : 'Generar Dashboard ✨'}
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
