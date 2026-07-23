'use client';

import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import type { PieChartWidget as PieChartWidgetType } from '@/lib/widgets/types';

export function PieChartWidget({ widget }: { widget: PieChartWidgetType }) {
  const { config, data } = widget;
  const items = Array.isArray(data) ? data : [];

  const colors = ['#6366F1', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4'];

  return (
    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
      {config.title && (
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{config.title}</h4>
      )}
      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            {config.showLegend !== false && <Legend />}
            <Pie
              data={items}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={config.variant === 'pie' ? 0 : 50}
              outerRadius={80}
              paddingAngle={2}
            >
              {items.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
