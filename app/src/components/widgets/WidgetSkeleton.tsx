'use client';

import React from 'react';
import type { WidgetType } from '@/lib/widgets/types';

type WidgetSkeletonProps = {
  type?: WidgetType;
  title?: string;
  className?: string;
};

export function KPISkeleton({ title }: { title?: string }) {
  return (
    <div className="widget-wrapper widget-skeleton" aria-busy="true" aria-label="Cargando métrica...">
      <div className="widget-skeleton-title">
        {title ? (
          <span className="widget-title opacity-70">{title}</span>
        ) : (
          <div className="skeleton-bar w-24 h-4" />
        )}
      </div>
      <div className="widget-skeleton-kpi-body">
        <div className="skeleton-bar w-36 h-9 rounded-md" />
        <div className="skeleton-bar w-28 h-4 rounded-full mt-3" />
      </div>
    </div>
  );
}

export function ChartSkeleton({ title, type }: { title?: string; type?: WidgetType }) {
  return (
    <div
      className="widget-wrapper widget-skeleton"
      aria-busy="true"
      aria-label={`Cargando gráfico${title ? `: ${title}` : ''}...`}
    >
      <div className="widget-skeleton-title">
        {title ? (
          <span className="widget-title opacity-70">{title}</span>
        ) : (
          <div className="skeleton-bar w-32 h-4" />
        )}
      </div>
      <div className="widget-skeleton-chart-body">
        {/* Y-axis line + bars/lines */}
        <div className="widget-skeleton-chart-grid">
          {type === 'pie-chart' ? (
            <div className="widget-skeleton-pie-wrapper">
              <div className="skeleton-circle w-36 h-36 rounded-full" />
            </div>
          ) : (
            <div className="widget-skeleton-bars">
              <div className="skeleton-bar w-full h-24 self-end rounded-t-sm" />
              <div className="skeleton-bar w-full h-36 self-end rounded-t-sm" />
              <div className="skeleton-bar w-full h-20 self-end rounded-t-sm" />
              <div className="skeleton-bar w-full h-44 self-end rounded-t-sm" />
              <div className="skeleton-bar w-full h-28 self-end rounded-t-sm" />
              <div className="skeleton-bar w-full h-32 self-end rounded-t-sm" />
            </div>
          )}
        </div>
        {/* X-axis ticks */}
        {type !== 'pie-chart' && (
          <div className="widget-skeleton-axis">
            <div className="skeleton-bar w-8 h-2.5" />
            <div className="skeleton-bar w-8 h-2.5" />
            <div className="skeleton-bar w-8 h-2.5" />
            <div className="skeleton-bar w-8 h-2.5" />
            <div className="skeleton-bar w-8 h-2.5" />
            <div className="skeleton-bar w-8 h-2.5" />
          </div>
        )}
      </div>
    </div>
  );
}

export function TableSkeleton({ title }: { title?: string }) {
  return (
    <div className="widget-wrapper widget-skeleton" aria-busy="true" aria-label="Cargando tabla de datos...">
      <div className="widget-skeleton-title">
        {title ? (
          <span className="widget-title opacity-70">{title}</span>
        ) : (
          <div className="skeleton-bar w-28 h-4" />
        )}
      </div>
      <div className="widget-skeleton-table-body">
        <div className="widget-skeleton-table-header">
          <div className="skeleton-bar w-20 h-3" />
          <div className="skeleton-bar w-24 h-3" />
          <div className="skeleton-bar w-16 h-3" />
          <div className="skeleton-bar w-20 h-3" />
        </div>
        <div className="widget-skeleton-table-rows">
          {[1, 2, 3, 4].map((row) => (
            <div key={row} className="widget-skeleton-table-row">
              <div className="skeleton-bar w-16 h-2.5" />
              <div className="skeleton-bar w-28 h-2.5" />
              <div className="skeleton-bar w-12 h-2.5" />
              <div className="skeleton-bar w-20 h-2.5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WidgetSkeleton({ type = 'line-chart', title }: WidgetSkeletonProps) {
  if (type === 'kpi') {
    return <KPISkeleton title={title} />;
  }
  if (type === 'table') {
    return <TableSkeleton title={title} />;
  }
  return <ChartSkeleton title={title} type={type} />;
}

export function DashboardGridSkeleton({
  count = 6,
  archetype = 'hero-focus',
}: {
  count?: number;
  archetype?: string;
}) {
  return (
    <div className="dashboard-surface" aria-busy="true" aria-label="Generando dashboard...">
      <header className="dashboard-header animate-pulse">
        <div className="dashboard-heading">
          <div className="skeleton-bar w-28 h-3 mb-2 rounded" />
          <div className="skeleton-bar w-64 h-8 rounded" />
          <div className="skeleton-bar w-96 h-4 mt-2 rounded" />
        </div>
      </header>
      <div className="dashboard-grid dashboard-grid--balanced" data-archetype={archetype}>
        {archetype === 'hero-focus' ? (
          <>
            <div className="dashboard-grid-item" style={{ gridColumn: '1 / span 6', gridRow: '1 / span 2' } as React.CSSProperties}>
              <KPISkeleton title="Métrica Principal" />
            </div>
            <div className="dashboard-grid-item" style={{ gridColumn: '7 / span 3', gridRow: '1 / span 1' } as React.CSSProperties}>
              <KPISkeleton title="Métrica Secundaria" />
            </div>
            <div className="dashboard-grid-item" style={{ gridColumn: '10 / span 3', gridRow: '1 / span 1' } as React.CSSProperties}>
              <KPISkeleton title="Eficiencia" />
            </div>
            <div className="dashboard-grid-item" style={{ gridColumn: '7 / span 6', gridRow: '2 / span 1' } as React.CSSProperties}>
              <ChartSkeleton title="Evolución Temporal" type="line-chart" />
            </div>
            <div className="dashboard-grid-item" style={{ gridColumn: '1 / span 12', gridRow: '3 / span 2' } as React.CSSProperties}>
              <TableSkeleton title="Detalle Operacional" />
            </div>
          </>
        ) : (
          Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="dashboard-grid-item"
              style={{
                gridColumn: i < 3 ? `${(i * 4) + 1} / span 4` : `${((i - 3) * 6) + 1} / span 6`,
                gridRow: i < 3 ? '1 / span 1' : '2 / span 2',
              } as React.CSSProperties}
            >
              {i < 3 ? <KPISkeleton /> : <ChartSkeleton type={i % 2 === 0 ? 'line-chart' : 'bar-chart'} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
