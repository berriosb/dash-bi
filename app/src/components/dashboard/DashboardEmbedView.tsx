'use client';

import { useEffect, useRef } from 'react';
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer';
import type { Widget } from '@/lib/widgets/types';

interface EmbedConfig {
  theme?: 'moderno-saas' | 'corporate' | 'transparent';
  hideTitle: boolean;
  allowExport: boolean;
  cspHeader?: string;
}

interface PublicDashboard {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  theme: string;
  widgets: unknown[];
}

export function DashboardEmbedView({
  dashboard,
  config,
}: {
  dashboard: PublicDashboard;
  config: EmbedConfig;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgets = (dashboard.widgets as Widget[]) ?? [];

  useEffect(() => {
    // Notify parent frame that the embedded dashboard has loaded
    if (typeof window !== 'undefined' && window.parent) {
      window.parent.postMessage(
        {
          type: 'dashbi:loaded',
          payload: {
            dashboardId: dashboard.id,
            title: dashboard.title,
          },
        },
        '*'
      );
    }

    // Auto-resize protocol
    const emitResize = () => {
      if (typeof window !== 'undefined' && window.parent && containerRef.current) {
        const height = containerRef.current.scrollHeight || document.documentElement.scrollHeight;
        window.parent.postMessage(
          {
            type: 'dashbi:resize',
            payload: { height },
          },
          '*'
        );
      }
    };

    emitResize();

    const resizeObserver = new ResizeObserver(() => {
      emitResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', emitResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', emitResize);
    };
  }, [dashboard.id, dashboard.title]);

  const isTransparent = config.theme === 'transparent';
  const themeClass = isTransparent
    ? 'bg-transparent'
    : config.theme === 'corporate'
    ? 'theme-corporate bg-background text-foreground'
    : 'theme-moderno-saas bg-background text-foreground';

  return (
    <div
      ref={containerRef}
      className={`min-h-full w-full p-4 transition-colors ${themeClass}`}
    >
      {!config.hideTitle && (
        <div className="mb-4 pb-2 border-b border-border/40">
          <h1 className="text-xl font-semibold tracking-tight">{dashboard.title}</h1>
          {dashboard.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{dashboard.description}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {widgets.length === 0 ? (
          <div className="col-span-12 py-8 text-center text-sm text-muted-foreground">
            Este dashboard no contiene widgets configurados.
          </div>
        ) : (
          widgets.map((widget) => {
            const colSpan = widget.position?.colSpan ?? 6;
            const spanClass =
              colSpan === 12
                ? 'col-span-12'
                : colSpan === 8
                ? 'col-span-12 md:col-span-8'
                : colSpan === 4
                ? 'col-span-12 sm:col-span-6 md:col-span-4'
                : 'col-span-12 md:col-span-6';

            return (
              <div key={widget.id} className={spanClass}>
                <WidgetRenderer widget={widget} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
