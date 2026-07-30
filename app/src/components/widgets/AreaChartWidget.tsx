'use client';

import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { AreaChartWidget as AreaChartWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';
import { HighDensityChart, HIGH_DENSITY_THRESHOLD } from './HighDensityChart';

export function AreaChartWidget({ widget }: { widget: AreaChartWidgetType }) {
  const { config, data } = widget;
  const series = React.useMemo(() => {
    return (data as { series?: Array<{ name: string; data: Array<{ x: string | number; y: number }> }> } | null)?.series ?? [];
  }, [data]);

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

  if (chartData.length >= HIGH_DENSITY_THRESHOLD) {
    const seriesKeys = series.map((s) => s.name);
    return (
      <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={!hasData}>
        <div className="h-full w-full p-2">
          <HighDensityChart
            type="area"
            data={chartData}
            xAxisKey="x"
            seriesKeys={seriesKeys}
            height="100%"
          />
        </div>
      </WidgetSurface>
    );
  }

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={!hasData}>
      <div className="widget-content" role="img" aria-label={`Gráfico de área${config.title ? `: ${config.title}` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            {config.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--color-border))" />}
            <XAxis dataKey="x" stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <YAxis stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <Tooltip />
            {config.showLegend !== false && <Legend />}
            {series.map((item, index) => (
              <Area
                key={item.name}
                type={config.smooth ? 'monotone' : 'linear'}
                dataKey={item.name}
                stroke={colors[index % colors.length]}
                fill={colors[index % colors.length]}
                fillOpacity={0.14}
                stackId={config.stacked ? '1' : undefined}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
