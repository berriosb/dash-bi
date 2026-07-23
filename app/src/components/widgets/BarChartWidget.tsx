'use client';

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { BarChartWidget as BarChartWidgetType } from '@/lib/widgets/types';

export function BarChartWidget({ widget }: { widget: BarChartWidgetType }) {
  const { config, data } = widget;
  const categories: string[] = (data as any)?.categories ?? [];
  const series: Array<{ name: string; data: number[] }> = (data as any)?.series ?? [];

  const chartData = React.useMemo(() => {
    return categories.map((cat: string, i: number) => {
      const row: Record<string, any> = { category: cat };
      series.forEach((s) => {
        row[s.name] = s.data[i] ?? 0;
      });
      return row;
    });
  }, [categories, series]);

  const colors = ['#6366F1', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899'];

  return (
    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
      {config.title && (
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{config.title}</h4>
      )}
      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout={config.orientation === 'horizontal' ? 'vertical' : 'horizontal'}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey={config.orientation === 'horizontal' ? undefined : 'category'} type={config.orientation === 'horizontal' ? 'number' : 'category'} stroke="#6B7280" fontSize={12} />
            <YAxis dataKey={config.orientation === 'horizontal' ? 'category' : undefined} type={config.orientation === 'horizontal' ? 'category' : 'number'} stroke="#6B7280" fontSize={12} />
            <Tooltip />
            {config.showLegend !== false && <Legend />}
            {series.map((s, idx: number) => (
              <Bar
                key={s.name}
                dataKey={s.name}
                fill={colors[idx % colors.length]}
                stackId={config.stacked ? 'a' : undefined}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
