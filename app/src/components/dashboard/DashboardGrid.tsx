'use client';

import React, { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDraggable,
} from '@dnd-kit/core';
import type { Dashboard, Widget } from '@/lib/widgets/types';
import { WidgetRenderer } from '../widgets/WidgetRenderer';

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    const id = String(active.id);
    const colWidth = 80;
    const rowHeight = 60;

    const colDelta = Math.round(delta.x / colWidth);
    const rowDelta = Math.round(delta.y / rowHeight);

    const updated = widgets.map((w) => {
      if (w.id !== id) return w;
      const newCol = Math.max(1, Math.min(12 - w.position.colSpan + 1, w.position.col + colDelta));
      const newRow = Math.max(1, w.position.row + rowDelta);
      return {
        ...w,
        position: {
          ...w.position,
          col: newCol,
          row: newRow,
        },
      };
    });

    setWidgets(updated);
    if (onLayoutChange) {
      onLayoutChange(updated);
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        className="grid grid-cols-12 gap-4 p-6 min-h-[500px]"
        data-dashboard-ready="true"
        data-archetype={dashboard.archetype || 'kpi-grid'}
      >
        {widgets.map((widget) => {
          const colSpanClass = `col-span-12 md:col-span-${widget.position.colSpan || 12}`;
          return (
            <div
              key={widget.id}
              className={`${colSpanClass} transition-all duration-150`}
              style={{ gridColumn: `span ${widget.position.colSpan || 12} / span ${widget.position.colSpan || 12}` }}
            >
              <DraggableWidget id={widget.id} isEditing={isEditing}>
                <WidgetRenderer widget={widget} />
              </DraggableWidget>
            </div>
          );
        })}
      </div>
    </DndContext>
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
      className={`relative h-full group ${isDragging ? 'z-50 opacity-75' : ''}`}
    >
      <div
        {...listeners}
        {...attributes}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 cursor-move bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-1 rounded text-xs shadow"
      >
        ⠿ Drag
      </div>
      {children}
    </div>
  );
}
