'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { trackOnboardingEvent } from '@/lib/onboarding/track';

/**
 * GeneratingStep — fires POST /api/dashboards/generate on mount,
 * persists dashboardId on success, and shows a retry CTA on failure.
 *
 * The step is re-entrant: clicking "Reintentar" clears the error and
 * triggers the fetch again. Back returns to the prompt step so the
 * user can adjust their prompt.
 */
export function GeneratingStep() {
  const prompt = useOnboardingStore((s) => s.prompt);
  const dataSourceId = useOnboardingStore((s) => s.dataSourceId);
  const selectedSourceType = useOnboardingStore((s) => s.selectedSourceType);
  const dashboardId = useOnboardingStore((s) => s.dashboardId);
  const setDashboardId = useOnboardingStore((s) => s.setDashboardId);
  const goToStep = useOnboardingStore((s) => s.goToStep);

  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    async function run() {
      const isDemo = selectedSourceType === 'demo';
      if (!isDemo && (!dataSourceId || !prompt.trim())) {
        setError('Falta seleccionar fuente de datos o escribir un prompt.');
        return;
      }
      try {
        const url = isDemo
          ? '/api/dashboards/templates/saas-mrr-analytics/instantiate'
          : '/api/dashboards/generate';
        const bodyPayload = isDemo
          ? JSON.stringify({ title: prompt.trim() || 'Demo SaaS Analytics' })
          : JSON.stringify({ prompt, dataSourceId });

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: bodyPayload,
        });
        if (cancelled) return;

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as { dashboardId?: string; dashboard?: { id: string } };
        const generatedId = body.dashboardId ?? body.dashboard?.id ?? '';
        if (generatedId) {
          setDashboardId(generatedId);
        }
        goToStep('success');
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        trackOnboardingEvent({ type: 'generation_failed', error: message, attempt });
        setError(message);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [attempt, prompt, dataSourceId, selectedSourceType, setDashboardId, goToStep]);

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-6 p-6 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">No pudimos generar tu dashboard</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => setAttempt((n) => n + 1)}>Reintentar</Button>
          <Button variant="ghost" onClick={() => goToStep('prompt')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al prompt
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6 text-center">
      <Loader2
        className="mx-auto h-9 w-9 animate-spin text-primary"
        data-testid="generating-spinner"
      />
      <div>
        <h1 className="text-xl font-semibold">Generando tu primer dashboard…</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estamos consultando tu fuente y armando los widgets con datos reales.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2 text-left opacity-60">
        <div className="p-3 border border-border/60 rounded-lg bg-surface/40 space-y-2">
          <div className="skeleton-bar w-16 h-3 rounded" />
          <div className="skeleton-bar w-24 h-6 rounded" />
        </div>
        <div className="p-3 border border-border/60 rounded-lg bg-surface/40 space-y-2">
          <div className="skeleton-bar w-20 h-3 rounded" />
          <div className="skeleton-bar w-20 h-6 rounded" />
        </div>
        <div className="col-span-2 p-3 border border-border/60 rounded-lg bg-surface/40 space-y-2">
          <div className="skeleton-bar w-28 h-3 rounded" />
          <div className="skeleton-bar w-full h-16 rounded" />
        </div>
      </div>

      {dashboardId && (
        <p className="text-xs text-muted-foreground">id: {dashboardId}</p>
      )}
    </div>
  );
}