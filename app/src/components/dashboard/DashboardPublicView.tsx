import { WidgetRenderer } from '@/components/widgets/WidgetRenderer';
import type { Widget } from '@/lib/widgets/types';

type PublicDashboard = {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  theme: string;
  widgets: unknown[];
};

/**
 * Read-only dashboard view for public share links (/share/[token]).
 *
 * Intentionally minimal: no edit chrome, no NLQA panel, no property panel,
 * no auth checks. Renders only the widget grid via WidgetRenderer.
 */
export function DashboardPublicView({ dashboard }: { dashboard: PublicDashboard }) {
  const widgets = (dashboard.widgets as Widget[]) ?? [];

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-semibold tracking-tight">{dashboard.title}</h1>
          {dashboard.description && (
            <p className="mt-1 text-sm text-muted-foreground">{dashboard.description}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Vista pública · Powered by{' '}
            <a className="underline" href="https://dash-bi.com" rel="noopener noreferrer">
              dash-bi
            </a>
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        {widgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este dashboard no tiene widgets.</p>
        ) : (
          widgets.map((w) => <WidgetRenderer key={w.id} widget={w} />)
        )}
      </div>
    </main>
  );
}