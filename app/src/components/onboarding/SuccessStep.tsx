'use client';

import { Button } from '@/components/ui/button';
import { PartyPopper, MessageSquare, Share2, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { useOnboardingStore } from '@/stores/onboardingStore';

export function SuccessStep() {
  const dashboardId = useOnboardingStore((s) => s.dashboardId);
  const reset = useOnboardingStore((s) => s.reset);

  const dashboardHref = dashboardId ? `/dashboards/${dashboardId}` : '/dashboards';

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 text-center sm:p-6">
      <PartyPopper className="mx-auto h-12 w-12 text-primary" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          🎉 ¡Tu primer dashboard está listo!
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href={`${dashboardHref}?openNlqa=1`}>
          <Button variant="outline" className="w-full">
            <MessageSquare className="mr-2 h-4 w-4" /> Ajustar con chat
          </Button>
        </Link>
        <Link href={`${dashboardHref}?openShare=1`}>
          <Button variant="outline" className="w-full">
            <Share2 className="mr-2 h-4 w-4" /> Compartir con cliente
          </Button>
        </Link>
        <Link href="/dashboards/new">
          <Button variant="outline" className="w-full">
            <LayoutDashboard className="mr-2 h-4 w-4" /> Crear otro
          </Button>
        </Link>
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button size="lg" onClick={reset} asChild={false}>
          <Link href={dashboardHref}>Ir al dashboard →</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Onboarding completo. Empezaste con buen pie.
        </p>
      </div>
    </div>
  );
}