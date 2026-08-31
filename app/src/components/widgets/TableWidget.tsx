'use client';

import React from 'react';
import type { TableWidget as TableWidgetType, TableConfig } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

type TableColumn = TableConfig['columns'][number];

function formatCellValue(
  value: unknown,
  format?: 'currency' | 'number' | 'percent' | 'date' | 'text'
): string {
  if (value === null || value === undefined || value === '') return '—';

  if (format === 'currency') {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) {
      return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(num);
    }
  }

  if (format === 'percent') {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) {
      const normalized = Math.abs(num) > 1 ? num / 100 : num;
      return new Intl.NumberFormat('es-CL', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(normalized);
    }
  }

  if (format === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) {
      return new Intl.NumberFormat('es-CL').format(num);
    }
  }

  if (format === 'date') {
    const d = value instanceof Date ? value : new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('es-CL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(d);
    }
  }

  return String(value);
}

export function TableWidget({ widget }: { widget: TableWidgetType }) {
  const { config, data } = widget;
  const rows = React.useMemo(
    () => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []),
    [data]
  );
  const columns = React.useMemo(() => config.columns || [], [config.columns]);

  const inferredColumns = React.useMemo<TableColumn[]>(() => {
    if (columns.length > 0) return columns;
    if (rows.length === 0 || !rows[0]) return [];
    return Object.keys(rows[0]).map((key) => ({ key, label: key }));
  }, [columns, rows]);

  return (
    <WidgetSurface
      widgetId={widget.id}
      title={config.title}
      isEmpty={rows.length === 0}
      emptyMessage="La consulta no devolvió filas para mostrar."
    >
      <div className="widget-table-container">
        <table className="widget-table">
          <thead>
            <tr>
              {inferredColumns.map((column) => {
                const isNumeric =
                  column.format === 'currency' ||
                  column.format === 'number' ||
                  column.format === 'percent';
                const align = column.align ?? (isNumeric ? 'right' : 'left');

                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={{ textAlign: align }}
                  >
                    {column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {inferredColumns.map((column) => {
                  const isNumeric =
                    column.format === 'currency' ||
                    column.format === 'number' ||
                    column.format === 'percent';
                  const align = column.align ?? (isNumeric ? 'right' : 'left');
                  const formatted = formatCellValue(row[column.key], column.format);

                  return (
                    <td
                      key={column.key}
                      className={isNumeric ? 'tabular-nums' : undefined}
                      style={{ textAlign: align }}
                    >
                      {formatted}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetSurface>
  );
}
