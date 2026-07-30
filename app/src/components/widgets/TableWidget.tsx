'use client';

import React from 'react';
import type { TableWidget as TableWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

export function TableWidget({ widget }: { widget: TableWidgetType }) {
  const { config, data } = widget;
  const rows = React.useMemo(() => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []), [data]);
  const columns = React.useMemo(() => config.columns || [], [config.columns]);

  const inferredColumns = React.useMemo(() => {
    if (columns.length > 0) return columns;
    if (rows.length === 0 || !rows[0]) return [];
    return Object.keys(rows[0]).map((key) => ({ key, label: key }));
  }, [columns, rows]);

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={rows.length === 0} emptyMessage="La consulta no devolvió filas para mostrar.">
      <div className="widget-table-container">
        <table className="widget-table">
          <thead>
            <tr>
              {inferredColumns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {inferredColumns.map((column) => <td key={column.key}>{String(row[column.key] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetSurface>
  );
}
