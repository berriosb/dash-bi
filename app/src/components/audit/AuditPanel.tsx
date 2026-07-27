'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Shield } from 'lucide-react';

type Entry = {
  id: string;
  action: string;
  userId: string | null;
  resource: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
};

const CATEGORIES = [
  { value: '', label: 'Todas las categorías' },
  { value: 'auth', label: 'Auth' },
  { value: 'org', label: 'Organización' },
  { value: 'llm', label: 'LLM config' },
  { value: 'datasource', label: 'Data sources' },
  { value: 'dashboard', label: 'Dashboards' },
  { value: 'query', label: 'Queries' },
  { value: 'export', label: 'Exports' },
  { value: 'public_link', label: 'Links públicos' },
  { value: 'nlqa', label: 'NLQA' },
];

const SINCE_OPTIONS = [
  { value: '1', label: 'Último día' },
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
];

async function fetchAudit(params: { category: string; sinceDays: string }) {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.sinceDays) qs.set('sinceDays', params.sinceDays);
  const res = await fetch(`/api/audit?${qs.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.entries as Entry[];
}

export function AuditPanel() {
  const [category, setCategory] = useState('');
  const [sinceDays, setSinceDays] = useState('7');

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['audit', category, sinceDays],
    queryFn: () => fetchAudit({ category, sinceDays }),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Audit log</h2>
          <Badge variant="outline">{data?.length ?? 0} eventos</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refrescar
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Categoría:</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Período:</span>
            <select
              value={sinceDays}
              onChange={(e) => setSinceDays(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {SINCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-destructive">
            Error al cargar audit log. ¿Tenés permisos de admin?
          </div>
        ) : !data || data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No hay eventos para los filtros seleccionados.
          </div>
        ) : (
          <div className="divide-y">
            {data.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[140px_1fr_120px] gap-4 px-4 py-3 text-sm"
              >
                <div className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString('es-AR')}
                </div>
                <div>
                  <code className="font-mono text-xs">{entry.action}</code>
                  {entry.resource && (
                    <span className="ml-2 text-xs text-muted-foreground">{entry.resource}</span>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {entry.userId ? entry.userId.slice(0, 8) : 'público'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}