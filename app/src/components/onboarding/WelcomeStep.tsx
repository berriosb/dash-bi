'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Database, MessageSquare, Sparkles, ArrowRight } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import Link from 'next/link';

const TEASERS = [
  {
    icon: Database,
    title: '1️⃣ Conectar fuente de datos',
    description: 'Elegí de dónde sacar la información.',
  },
  {
    icon: MessageSquare,
    title: '2️⃣ Describir qué quieres ver',
    description: 'En lenguaje natural, tipo chat.',
  },
  {
    icon: Sparkles,
    title: '3️⃣ Dashboard generado con IA',
    description: 'Ajustá, exportá, compartí.',
  },
] as const;

export function WelcomeStep() {
  const goToStep = useOnboardingStore((s) => s.goToStep);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">👋 ¡Bienvenido a dash-bi!</h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Vamos a crear tu primer dashboard en 3 pasos. Tardarás menos de 3 minutos.
        </p>
      </header>

      <Card className="divide-y">
        {TEASERS.map(({ icon: Icon, title, description }) => (
          <CardContent key={title} className="flex items-start gap-4 p-4">
            <Icon className="mt-1 h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-medium">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </CardContent>
        ))}
      </Card>

      <div className="flex flex-col items-center gap-2">
        <Button size="lg" onClick={() => goToStep('choose_source')}>
          Empezar
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground">⏱ Tiempo estimado: 3 min</p>
        <Link
          href="/"
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Skip onboarding →
        </Link>
      </div>
    </div>
  );
}