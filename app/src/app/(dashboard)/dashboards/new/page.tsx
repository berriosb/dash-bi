'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * /dashboards/new — creates an empty dashboard.
 *
 * This route existed only as a link target: the list page and the
 * onboarding success step both pointed at `/dashboards/new`, and Next
 * returned a 404 for a page that was never written. Creation itself
 * already had a server endpoint (`POST /api/dashboards`), so the page is
 * a thin form over it instead of a duplicate of the generate flow.
 */
export default function NewDashboardPage() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [theme, setTheme] = useState<'moderno-saas' | 'corporate'>('moderno-saas');

  const create = useMutation({
    mutationFn: async (input: { title: string; description?: string; theme: string }) => {
      const res = await fetch('/api/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? err?.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ dashboard?: { id?: string }; id?: string }>;
    },
    onSuccess: (data) => {
      const id = data?.dashboard?.id ?? data?.id;
      router.push(typeof id === 'string' ? `/dashboards/${id}` : '/dashboards');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate({
      title: trimmed,
      ...(description.trim() ? { description: description.trim() } : {}),
      theme,
    });
  };

  return (
    <div className="platform-page">
      <Button variant="ghost" asChild className="mb-4 -ml-2">
        <Link href="/dashboards">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver a dashboards
        </Link>
      </Button>

      <div className="max-w-2xl">
        <div className="mb-6">
          <p className="platform-page__eyebrow">Nuevo</p>
          <h1 className="platform-page__title">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Crear dashboard
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Detalles</CardTitle>
            <CardDescription>
              Empieza en blanco y agrega widgets cuando conectes una fuente de datos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ventas Q3"
                  maxLength={200}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descripción (opcional)</Label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Indicadores de ventas del tercer trimestre"
                  maxLength={2000}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="theme">Tema</Label>
                <select
                  id="theme"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as typeof theme)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
                >
                  <option value="moderno-saas">Moderno SaaS</option>
                  <option value="corporate">Corporativo</option>
                </select>
              </div>

              {create.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {create.error instanceof Error ? create.error.message : 'No se pudo crear el dashboard.'}
                </p>
              ) : null}

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={create.isPending || !title.trim()}>
                  {create.isPending ? 'Creando…' : 'Crear dashboard'}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/dashboards">Cancelar</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}