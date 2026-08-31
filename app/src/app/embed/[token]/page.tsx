import { headers } from 'next/headers';
import { getEmbedDashboard } from '@/lib/embed/get-embed-dashboard';
import { DashboardEmbedView } from '@/components/dashboard/DashboardEmbedView';

export const dynamic = 'force-dynamic';

export default async function DashboardEmbedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headerList = await headers();
  const origin = headerList.get('origin') || headerList.get('referer') || undefined;

  const result = await getEmbedDashboard(token, origin);

  if (result.status === 'invalid_token' || result.status === 'not_found') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Dashboard no disponible</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            El enlace de embebido no es válido o ha sido revocado.
          </p>
        </div>
      </main>
    );
  }

  if (result.status === 'expired') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Enlace de embebido expirado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            El token de acceso ha expirado. Por favor, solicita un nuevo enlace.
          </p>
        </div>
      </main>
    );
  }

  if (result.status === 'invalid_origin') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Dominio no autorizado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este dashboard no está autorizado para ser embebido en el dominio actual.
          </p>
        </div>
      </main>
    );
  }

  return <DashboardEmbedView dashboard={result.dashboard} config={result.config} />;
}
