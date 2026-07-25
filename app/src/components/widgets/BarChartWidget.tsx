'use client';

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { BarChartWidget as BarChartWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

export function BarChartWidget({ widget }: { widget: BarChartWidgetType }) {
  const { config, data } = widget;
  const categories: string[] = (data as any)?.categories ?? [];
  const series: Array<{ name: string; data: number[] }> = (data as any)?.series ?? [];
  const hasData = categories.length > 0 && series.some((item) => item.data.length > 0);

  const chartData = React.useMemo(
    () => categories.map((category, index) => ({
      category,
      ...Object.fromEntries(series.map((item) => [item.name, item.data[index] ?? 0])),
    })),
    [categories, series]
  );

  const colors = ['hsl(var(--color-primary))', 'hsl(var(--color-secondary))', 'hsl(var(--color-success))', 'hsl(var(--color-warning))', 'hsl(var(--color-accent))'];

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={!hasData}>
      <div className="widget-content" role="img" aria-label={`Gráfico de barras${config.title ? `: ${config.title}` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout={config.orientation === 'horizontal' ? 'vertical' : 'horizontal'}>
            {config.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--color-border))" />}
            <XAxis dataKey={config.orientation === 'horizontal' ? undefined : 'category'} type={config.orientation === 'horizontal' ? 'number' : 'category'} stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <YAxis dataKey={config.orientation === 'horizontal' ? 'category' : undefined} type={config.orientation === 'horizontal' ? 'category' : 'number'} stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <Tooltip />
            {config.showLegend !== false && <Legend />}
            {series.map((item, index) => (
              <Bar key={item.name} dataKey={item.name} fill={colors[index % colors.length]} stackId={config.stacked ? 'a' : undefined} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
