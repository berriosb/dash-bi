'use client';

import React, { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  useDraggable,
} from '@dnd-kit/core';
import type { Dashboard, Density, Widget } from '@/lib/widgets/types';
import { WidgetRenderer } from '../widgets/WidgetRenderer';

const DENSITY_CLASS: Record<Density, string> = {
  spacious: 'dashboard-grid--spacious',
  balanced: 'dashboard-grid--balanced',
  dense: 'dashboard-grid--dense',
};

const ARCHETYPE_LABELS: Record<NonNullable<Dashboard['archetype']>, string> = {
  'kpi-grid': 'Vista general',
  'hero-focus': 'Métrica destacada',
  'cohort-matrix': 'Análisis de cohortes',
  'sales-pipeline': 'Pipeline comercial',
  'executive-summary': 'Resumen ejecutivo',
  'operations-live': 'Monitoreo operativo',
  'finance-report': 'Reporte financiero',
  'growth-metrics': 'Métricas de crecimiento',
  custom: 'Composición personalizada',
};

export function DashboardGrid({
  dashboard,
  isEditing = false,
  onLayoutChange,
}: {
  dashboard: Dashboard;
  isEditing?: boolean;
  onLayoutChange?: (widgets: Widget[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );
  const [widgets, setWidgets] = useState<Widget[]>(dashboard.widgets || []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setWidgets(dashboard.widgets || []);
  }, [dashboard.widgets]);

  const density = dashboard.archetypeVariant?.density ?? 'balanced';
  const archetype = dashboard.archetype ?? 'custom';
  const descriptionId = dashboard.description ? 'dashboard-description' : undefined;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    const id = String(active.id);
    const columnWidth = 80;
    const rowHeight = 60;
    const columnDelta = Math.round(delta.x / columnWidth);
    const rowDelta = Math.round(delta.y / rowHeight);

    const updated = widgets.map((widget) => {
      if (widget.id !== id) return widget;

      return {
        ...widget,
        position: {
          ...widget.position,
          col: Math.max(
            1,
            Math.min(12 - widget.position.colSpan + 1, widget.position.col + columnDelta)
          ),
          row: Math.max(1, widget.position.row + rowDelta),
        },
      };
    });

    setWidgets(updated);
    onLayoutChange?.(updated);
  };

  return (
    <section
      className="dashboard-surface"
      data-theme={dashboard.theme}
      data-density={density}
      aria-labelledby="dashboard-title"
      aria-describedby={descriptionId}
    >
      <header className="dashboard-header">
        <div className="dashboard-heading">
          <p className="dashboard-eyebrow">Panel de decisión</p>
          <h2 id="dashboard-title" className="dashboard-title">
            {dashboard.title}
          </h2>
          {dashboard.description && (
            <p id={descriptionId} className="dashboard-description">
              {dashboard.description}
            </p>
          )}
        </div>
        <dl className="dashboard-context" aria-label="Contexto del dashboard">
          <div>
            <dt>Vista</dt>
            <dd>{ARCHETYPE_LABELS[archetype]}</dd>
          </div>
          <div>
            <dt>Densidad</dt>
            <dd>{density === 'spacious' ? 'Espaciosa' : density === 'dense' ? 'Compacta' : 'Equilibrada'}</dd>
          </div>
          {isEditing && (
            <div className="dashboard-edit-status" role="status">
              <dt>Estado</dt>
              <dd>Edición activa</dd>
            </div>
          )}
        </dl>
      </header>

      {widgets.length === 0 ? (
        <div className="dashboard-empty" role="status">
          <strong>Este dashboard aún no tiene widgets.</strong>
          <p>Agrega una visualización o genera una nueva propuesta para comenzar.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div
            className={`dashboard-grid ${DENSITY_CLASS[density]}`}
            data-dashboard-ready="true"
            data-archetype={archetype}
          >
            {widgets.map((widget) => (
              <div
                key={widget.id}
                className="dashboard-grid-item"
                style={{
                  '--widget-column-start': widget.position.col,
                  '--widget-column-span': widget.position.colSpan || 12,
                  '--widget-row-start': widget.position.row,
                  '--widget-row-span': widget.position.rowSpan,
                } as React.CSSProperties}
              >
                <DraggableWidget id={widget.id} isEditing={isEditing}>
                  <WidgetRenderer widget={widget} />
                </DraggableWidget>
              </div>
            ))}
          </div>
        </DndContext>
      )}
    </section>
  );
}

function DraggableWidget({
  id,
  isEditing,
  children,
}: {
  id: string;
  isEditing: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  if (!isEditing) return <div className="h-full">{children}</div>;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="dashboard-editable-widget"
      data-dragging={isDragging ? 'true' : 'false'}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="dashboard-drag-handle"
        aria-label="Mover widget"
      >
        <span aria-hidden="true">⠿</span>
        <span>Mover</span>
      </button>
      {children}
    </div>
  );
}
