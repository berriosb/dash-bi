'use client';

import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { LineChartWidget as LineChartWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

export function LineChartWidget({ widget }: { widget: LineChartWidgetType }) {
  const { config, data } = widget;
  const series: Array<{ name: string; data: Array<{ x: string | number; y: number }> }> = (data as any)?.series ?? [];
  const hasData = series.some((item) => item.data.length > 0);

  const chartData = React.useMemo(() => {
    const map = new Map<string | number, Record<string, string | number>>();
    series.forEach((item) => {
      item.data.forEach((point) => {
        const existing = map.get(point.x) ?? { x: point.x };
        existing[item.name] = point.y;
        map.set(point.x, existing);
      });
    });
    return Array.from(map.values());
  }, [series]);

  const colors = ['hsl(var(--color-primary))', 'hsl(var(--color-secondary))', 'hsl(var(--color-success))', 'hsl(var(--color-warning))', 'hsl(var(--color-accent))'];

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={!hasData}>
      <div className="widget-content" role="img" aria-label={`Gráfico de líneas${config.title ? `: ${config.title}` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            {config.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--color-border))" />}
            <XAxis dataKey="x" stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <YAxis stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <Tooltip />
            {config.showLegend !== false && <Legend />}
            {series.map((item, index) => (
              <Line
                key={item.name}
                type={config.smooth ? 'monotone' : 'linear'}
                dataKey={item.name}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={config.showPoints ?? false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
