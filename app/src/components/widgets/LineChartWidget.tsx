'use client';

import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { LineChartWidget as LineChartWidgetType } from '@/lib/widgets/types';

export function LineChartWidget({ widget }: { widget: LineChartWidgetType }) {
  const { config, data } = widget;
  const series: Array<{ name: string; data: Array<{ x: any; y: any }> }> = (data as any)?.series ?? [];

  const chartData = React.useMemo(() => {
    if (!series.length) return [];
    const map = new Map<string | number, Record<string, any>>();

    series.forEach((s) => {
      s.data.forEach((pt) => {
        const existing = map.get(pt.x) ?? { x: pt.x };
        existing[s.name] = pt.y;
        map.set(pt.x, existing);
      });
    });

    return Array.from(map.values());
  }, [series]);

  const colors = ['#6366F1', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899'];

  return (
    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
      {config.title && (
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{config.title}</h4>
      )}
      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="x" stroke="#6B7280" fontSize={12} />
            <YAxis stroke="#6B7280" fontSize={12} />
            <Tooltip />
            {config.showLegend !== false && <Legend />}
            {series.map((s, idx: number) => (
              <Line
                key={s.name}
                type={config.smooth ? 'monotone' : 'linear'}
                dataKey={s.name}
                stroke={colors[idx % colors.length]}
                strokeWidth={2}
                dot={config.showPoints ?? false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
