'use client';

import type { ReactNode } from 'react';

type WidgetSurfaceProps = {
  widgetId: string;
  title?: string;
  children: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  isLoading?: boolean;
  className?: string;
};

/** Shared visual and semantic shell for every dashboard widget. */
export function WidgetSurface({
  widgetId,
  title,
  children,
  isEmpty = false,
  emptyMessage = 'No hay datos disponibles para este widget.',
  isLoading = false,
  className = '',
}: WidgetSurfaceProps) {
  const titleId = widgetId ? `widget-title-${String(widgetId).replace(/[^a-zA-Z0-9_-]/g, '-')}` : undefined;

  return (
    <section
      className={`widget-wrapper ${className}`.trim()}
      aria-labelledby={title ? titleId : undefined}
      aria-busy={isLoading}
      data-widget-id={widgetId}
    >
      {title && (
        <h3 id={titleId} className="widget-title">
          {title}
        </h3>
      )}
      {isLoading ? (
        <div className="widget-skeleton-body animate-pulse" role="status" aria-label="Cargando...">
          <div className="skeleton-bar w-full h-32 rounded-md" />
        </div>
      ) : isEmpty ? (
        <div className="widget-empty" role="status">
          <span className="widget-empty-mark" aria-hidden="true">
            —
          </span>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
