'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Database, CreditCard, FileSpreadsheet, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useOnboardingStore, type SourceType } from '@/stores/onboardingStore';

const SOURCES: Array<{
  type: SourceType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { type: 'postgres', label: 'PostgreSQL', description: 'Conectá tu DB directamente', icon: Database },
  { type: 'stripe', label: 'Stripe', description: 'Revenue, MRR, churn, subs', icon: CreditCard },
  { type: 'sheets', label: 'Google Sheets', description: 'Tus reportes', icon: FileSpreadsheet },
];

export function ChooseSourceStep() {
  const selectedSourceType = useOnboardingStore((s) => s.selectedSourceType);
  const setSelectedSourceType = useOnboardingStore((s) => s.setSelectedSourceType);
  const goToStep = useOnboardingStore((s) => s.goToStep);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">¿Qué querés conectar?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí una fuente para empezar. Podés conectar otras después desde Settings.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {SOURCES.map(({ type, label, description, icon: Icon }) => {
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
                'cursor-pointer transition-colors hover:border-primary',
                isSelected && 'border-primary ring-2 ring-primary'
              )}
            >
              <CardContent className="flex flex-col items-start gap-3 p-4">
                <Icon className="h-6 w-6 text-primary" />
                <div>
                  <h2 className="font-medium">{label}</h2>
                  <p className="text-sm text-muted-foreground">{description}</p>
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