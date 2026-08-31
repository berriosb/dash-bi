'use client';

import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { BarChartWidget as BarChartWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';
import {
  CHART_COLORS,
  chartTooltipContentStyle,
  chartTooltipItemStyle,
  chartAxisTickStyle,
  chartGridStyle,
} from './chartTheme';

export function BarChartWidget({ widget }: { widget: BarChartWidgetType }) {
  const { config, data } = widget;
  const categories = React.useMemo(() => {
    return (data as { categories?: string[] } | null)?.categories ?? [];
  }, [data]);

  const series = React.useMemo(() => {
    return (data as { series?: Array<{ name: string; data: number[] }> } | null)?.series ?? [];
  }, [data]);

  const hasData = categories.length > 0 && series.some((item) => item.data.length > 0);

  const chartData = React.useMemo(
    () =>
      categories.map((category, index) => ({
        category,
        ...Object.fromEntries(series.map((item) => [item.name, item.data[index] ?? 0])),
      })),
    [categories, series]
  );

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={!hasData}>
      <div
        className="widget-content"
        role="img"
        aria-label={`Gráfico de barras${config.title ? `: ${config.title}` : ''}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout={config.orientation === 'horizontal' ? 'vertical' : 'horizontal'}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
          >
            {config.showGrid !== false && <CartesianGrid {...chartGridStyle} />}
            <XAxis
              dataKey={config.orientation === 'horizontal' ? undefined : 'category'}
              type={config.orientation === 'horizontal' ? 'number' : 'category'}
              tick={chartAxisTickStyle}
              stroke="hsl(var(--color-border-hsl))"
            />
            <YAxis
              dataKey={config.orientation === 'horizontal' ? 'category' : undefined}
              type={config.orientation === 'horizontal' ? 'category' : 'number'}
              tick={chartAxisTickStyle}
              stroke="hsl(var(--color-border-hsl))"
            />
            <Tooltip
              contentStyle={chartTooltipContentStyle}
              itemStyle={chartTooltipItemStyle}
            />
            {config.showLegend !== false && <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />}
            {series.map((item, index) => (
              <Bar
                key={item.name}
                dataKey={item.name}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                stackId={config.stacked ? 'a' : undefined}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
