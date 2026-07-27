import { getPublicDashboard } from '@/lib/sharing/get-public-dashboard';
import { DashboardPublicView } from '@/components/dashboard/DashboardPublicView';

export const dynamic = 'force-dynamic';

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getPublicDashboard(token);

  if (result.status === 'not_found') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Enlace no encontrado</h1>
          <p className="mt-2 text-muted-foreground">
            El enlace que seguiste no existe o fue eliminado por el propietario.
          </p>
        </div>
      </main>
    );
  }

  if (result.status === 'expired') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Enlace expirado</h1>
          <p className="mt-2 text-muted-foreground">
            Este enlace público venció. Pedile al propietario uno nuevo.
          </p>
        </div>
      </main>
    );
  }

  if (result.status === 'revoked') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Enlace revocado</h1>
          <p className="mt-2 text-muted-foreground">
            El propietario revocó este enlace público.
          </p>
        </div>
      </main>
    );
  }

  return <DashboardPublicView dashboard={result.dashboard} />;
}