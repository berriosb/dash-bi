import { getPrintDashboard } from '@/lib/export/get-print-dashboard';
import { DashboardPrintView } from '@/components/dashboard/DashboardPrintView';

export const dynamic = 'force-dynamic';

export default async function PrintDashboardPage({
  params: _params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Token faltante</h1>
          <p className="mt-2 text-muted-foreground">
            El enlace de impresión requiere un token válido.
          </p>
        </div>
      </main>
    );
  }

  const result = await getPrintDashboard(token);

  if (result.status === 'unauthorized') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Token inválido o expirado</h1>
          <p className="mt-2 text-muted-foreground">
            El token de impresión ya fue usado o venció (30 minutos).
          </p>
        </div>
      </main>
    );
  }

  if (result.status === 'not_found') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">Dashboard no encontrado</h1>
          <p className="mt-2 text-muted-foreground">
            El dashboard asociado al token no existe.
          </p>
        </div>
      </main>
    );
  }

  return <DashboardPrintView dashboard={result.dashboard} />;
}