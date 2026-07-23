'use client';

import React from 'react';
import type { TableWidget as TableWidgetType } from '@/lib/widgets/types';

export function TableWidget({ widget }: { widget: TableWidgetType }) {
  const { config, data } = widget;
  const rows: Record<string, any>[] = Array.isArray(data) ? data : [];
  const columns = config.columns || [];

  const inferredColumns = React.useMemo(() => {
    if (columns.length > 0) return columns;
    if (rows.length === 0 || !rows[0]) return [];
    return Object.keys(rows[0]).map((key) => ({ key, label: key }));
  }, [columns, rows]);

  return (
    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full overflow-hidden">
      {config.title && (
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{config.title}</h4>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300 border-collapse">
          <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 sticky top-0">
            <tr>
              {inferredColumns.map((col: { key: string; label: string }) => (
                <th key={col.key} className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                {inferredColumns.map((col: { key: string; label: string }) => (
                  <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                    {String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
