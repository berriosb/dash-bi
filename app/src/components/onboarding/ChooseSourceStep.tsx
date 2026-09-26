'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, CreditCard, FileSpreadsheet, Sparkles, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useOnboardingStore, type SourceType } from '@/stores/onboardingStore';

const SOURCES: Array<{
  type: SourceType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}> = [
  {
    type: 'demo',
    label: 'Modo Demo',
    description: 'Datos de ejemplo listos (sin configuración)',
    icon: Sparkles,
    badge: 'Recomendado',
  },
  { type: 'postgres', label: 'PostgreSQL', description: 'Conectá tu DB directamente', icon: Database },
  { type: 'stripe', label: 'Stripe', description: 'Revenue, MRR, churn, subs', icon: CreditCard },
  { type: 'sheets', label: 'Google Sheets', description: 'Tus reportes', icon: FileSpreadsheet },
];

export function ChooseSourceStep() {
  const selectedSourceType = useOnboardingStore((s) => s.selectedSourceType);
  const setSelectedSourceType = useOnboardingStore((s) => s.setSelectedSourceType);
  const goToStep = useOnboardingStore((s) => s.goToStep);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">¿Qué querés conectar?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí una fuente para empezar o probá con datos de ejemplo. Podés conectar otras después desde Fuentes de Datos.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {SOURCES.map(({ type, label, description, icon: Icon, badge }) => {
          const isSelected = selectedSourceType === type;
          return (
            <Card
              key={type}
              role="button"
              tabIndex={0}
              data-testid={`source-${type}`}
              aria-pressed={isSelected}
              onClick={() => setSelectedSourceType(type)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedSourceType(type);
                }
              }}
              className={cn(
                'cursor-pointer transition-colors hover:border-primary relative flex flex-col justify-between',
                isSelected && 'border-primary ring-2 ring-primary'
              )}
            >
              <CardContent className="flex flex-col items-start gap-3 p-4">
                <div className="flex items-center justify-between w-full">
                  <Icon className="h-6 w-6 text-primary" />
                  {badge && (
                    <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30 font-semibold uppercase">
                      {badge}
                    </Badge>
                  )}
                </div>
                <div>
                  <h2 className="font-medium">{label}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => goToStep('welcome')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
        <Button onClick={() => goToStep('prompt')} disabled={!selectedSourceType}>
          Continuar
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}