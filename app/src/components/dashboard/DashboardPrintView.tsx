import { WidgetRenderer } from '@/components/widgets/WidgetRenderer';
import type { Widget } from '@/lib/widgets/types';

type PrintableDashboard = {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  theme: string;
  widgets: unknown[];
};

/**
 * Print-mode dashboard view for the PDF worker.
 *
 * Renders a clean, A4/Letter-friendly layout with header (title +
 * generated timestamp) and footer (Powered-by + URL). No interactive
 * widgets, no editing chrome — the worker takes a screenshot of this.
 */
export function DashboardPrintView({ dashboard }: { dashboard: PrintableDashboard }) {
  const widgets = (dashboard.widgets as Widget[]) ?? [];
  const generatedAt = new Date().toLocaleString('es-AR');

  return (
    <main
      className="min-h-screen bg-white text-black"
      data-dashboard-ready="true"
      data-print-mode="true"
    >
      <header className="border-b border-neutral-300 bg-white px-8 py-6">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-tight">{dashboard.title}</h1>
          {dashboard.description && (
            <p className="mt-2 text-base text-neutral-600">{dashboard.description}</p>
          )}
          <p className="mt-3 text-xs text-neutral-500">Generado: {generatedAt}</p>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-6 p-8">
        {widgets.length === 0 ? (
          <p className="text-sm text-neutral-500">Este dashboard no tiene widgets.</p>
        ) : (
          widgets.map((w) => <WidgetRenderer key={w.id} widget={w} />)
        )}
      </div>
      <footer className="border-t border-neutral-300 px-8 py-4 text-center text-xs text-neutral-500">
        dash-bi · {process.env.NEXT_PUBLIC_APP_URL ?? 'https://dash-bi.com'}
      </footer>
    </main>
  );
}