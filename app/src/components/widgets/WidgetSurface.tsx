'use client';

import * as React from 'react';
import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { WidgetExplainModal } from './WidgetExplainModal';

type WidgetSurfaceProps = {
  widgetId: string;
  title?: string;
  children: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  isLoading?: boolean;
  className?: string;
  widgetType?: string;
  widgetData?: unknown;
  context?: {
    dashboardTitle?: string;
    timeWindow?: string;
    comparativo?: string;
  };
  onExplain?: () => void;
  showExplain?: boolean;
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
  widgetType = 'kpi',
  widgetData,
  context,
  onExplain,
  showExplain = true,
}: WidgetSurfaceProps) {
  const [isExplainOpen, setIsExplainOpen] = React.useState(false);
  const titleId = widgetId ? `widget-title-${String(widgetId).replace(/[^a-zA-Z0-9_-]/g, '-')}` : undefined;

  const canExplain = showExplain && !isLoading && !isEmpty && Boolean(title);

  const handleExplainClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExplain) {
      onExplain();
    } else {
      setIsExplainOpen(true);
    }
  };

  return (
    <section
      className={`widget-wrapper ${className}`.trim()}
      aria-labelledby={title ? titleId : undefined}
      aria-busy={isLoading}
      data-widget-id={widgetId}
    >
      {(title || canExplain) && (
        <div className="flex items-center justify-between gap-2 mb-2">
          {title && (
            <h3 id={titleId} className="widget-title mb-0">
              {title}
            </h3>
          )}
          {canExplain && (
            <button
              type="button"
              onClick={handleExplainClick}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 px-1.5 py-0.5 rounded-md transition-colors group cursor-pointer shrink-0"
              aria-label={`Explicar métrica de ${title}`}
              title="¿Por qué varió esta métrica?"
            >
              <Sparkles className="w-3 h-3 text-primary transition-transform group-hover:scale-110" />
              <span className="hidden sm:inline">Explicar</span>
            </button>
          )}
        </div>
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

      {isExplainOpen && (
        <WidgetExplainModal
          isOpen={isExplainOpen}
          onClose={() => setIsExplainOpen(false)}
          widgetTitle={title ?? 'Métrica'}
          widgetType={widgetType}
          widgetData={widgetData}
          context={context}
        />
      )}
    </section>
  );
}
