'use client';

import Link from 'next/link';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Route-level error boundary.
 *
 * Without this file any unhandled exception in a server component or a
 * route handler bubbles to the framework's default screen, which shows a
 * bare stack digest and no way back into the app. It also keeps the
 * digest visible: it is the only handle support has on the server logs,
 * which are correlated with it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-destructive mx-auto" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-foreground">
          Algo salió mal en esta pantalla
        </h1>
        <p className="text-sm text-muted-foreground">
          El error quedó registrado. Puedes reintentar; si se repite, comparte el código
          con soporte.
        </p>
        {error.digest ? (
          <p className="text-xs font-mono text-muted-foreground">
            Código: {error.digest}
          </p>
        ) : null}
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboards">
              <LayoutDashboard className="h-4 w-4 mr-2" />
              Ir a mis dashboards
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}