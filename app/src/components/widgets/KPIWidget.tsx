'use client';

import React from 'react';
import type { KPIWidget as KPIWidgetType } from '@/lib/widgets/types';

export function KPIWidget({ widget }: { widget: KPIWidgetType }) {
  const { config, data } = widget;
  const value = data?.value ?? 0;
  const delta = data?.delta;

  const formattedValue = React.useMemo(() => {
    if (config.format === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    }
    if (config.format === 'percent') {
      return `${value.toFixed(1)}%`;
    }
    return new Intl.NumberFormat('en-US').format(value);
  }, [value, config.format]);

  return (
    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between h-full">
      <div>
        {config.title && (
          <h4 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{config.title}</h4>
        )}
        <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          {formattedValue}
        </div>
      </div>
      {config.showDelta !== false && delta !== undefined && (
        <div className={`mt-2 text-xs font-medium flex items-center gap-1 ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          <span>{delta >= 0 ? '↑' : '↓'}</span>
          <span>{Math.abs(delta).toFixed(1)}% vs periodo anterior</span>
        </div>
      )}
    </div>
  );
}
