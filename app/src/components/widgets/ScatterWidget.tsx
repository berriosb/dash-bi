'use client';

import React from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { ScatterWidget as ScatterWidgetType } from '@/lib/widgets/types';

export function ScatterWidget({ widget }: { widget: ScatterWidgetType }) {
  const { config, data } = widget;
  const items = Array.isArray(data) ? data : [];

  return (
    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
      {config.title && (
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{config.title}</h4>
      )}
      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="x" name={config.xLabel || 'X'} stroke="#6B7280" fontSize={12} />
            <YAxis dataKey="y" name={config.yLabel || 'Y'} stroke="#6B7280" fontSize={12} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Scatter name="Puntos" data={items} fill="#6366F1" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
