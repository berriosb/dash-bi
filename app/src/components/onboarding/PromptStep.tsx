'use client';

import { useMemo, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles, ArrowLeft } from 'lucide-react';
import { useOnboardingStore, type SourceType } from '@/stores/onboardingStore';

const SUGGESTIONS_BY_TYPE: Record<SourceType, string[]> = {
  postgres: [
    'Top 10 productos más vendidos este mes',
    'Usuarios activos por día, últimos 30 días',
    'Revenue por región, comparado con mes anterior',
  ],
  stripe: [
    'Revenue mensual de los últimos 6 meses',
    'MRR vs churn por cohorte',
    'Top 20 clientes por LTV',
  ],
  sheets: [
    'Resumen de la hoja Summary por categoría',
    'Tendencia de ventas por región',
    'Comparación Q1 vs Q2 por métrica',
  ],
};

const GENERIC_SUGGESTIONS = [
  'Top 10 productos más vendidos',
  'Nuevos clientes por semana',
  'Resumen ejecutivo de la organización',
];

export function PromptStep() {
  const selectedSourceType = useOnboardingStore((s) => s.selectedSourceType);
  const prompt = useOnboardingStore((s) => s.prompt);
  const setPrompt = useOnboardingStore((s) => s.setPrompt);
  const goToStep = useOnboardingStore((s) => s.goToStep);

  const suggestions = useMemo(() => {
    if (selectedSourceType && SUGGESTIONS_BY_TYPE[selectedSourceType]) {
      return SUGGESTIONS_BY_TYPE[selectedSourceType];
    }
    return GENERIC_SUGGESTIONS;
  }, [selectedSourceType]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-focus the textarea when this step mounts.
    textareaRef.current?.focus();
  }, []);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    goToStep('generating');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          ¡Listo! Tu fuente está conectada.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ahora describí qué querés ver. Algunos ejemplos para inspirarte:
        </p>
      </header>

      <div className="space-y-2">
        {suggestions.map((s) => (
          <Card
            key={s}
            role="button"
            tabIndex={0}
            data-testid={`suggestion-${s.slice(0, 12)}`}
            onClick={() => setPrompt(s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setPrompt(s);
              }
            }}
            className="cursor-pointer transition-colors hover:border-primary"
          >
            <CardContent className="flex items-center gap-3 p-3 text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              {s}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <label htmlFor="onboarding-prompt" className="text-sm text-muted-foreground">
          O escribí lo tuyo:
        </label>
        <textarea
          id="onboarding-prompt"
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
          placeholder="Mostrame el revenue de los últimos 6 meses, agrupado por plan"
        />
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => goToStep('choose_source')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
        <Button onClick={handleGenerate} disabled={!prompt.trim()}>
          <Sparkles className="mr-2 h-4 w-4" />
          Generar mi primer dashboard
        </Button>
      </div>
    </div>
  );
}