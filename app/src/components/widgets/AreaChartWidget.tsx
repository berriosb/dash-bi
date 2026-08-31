'use client';

import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { AreaChartWidget as AreaChartWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';
import { HighDensityChart, HIGH_DENSITY_THRESHOLD } from './HighDensityChart';
import {
  CHART_COLORS,
  chartTooltipContentStyle,
  chartTooltipItemStyle,
  chartAxisTickStyle,
  chartGridStyle,
} from './chartTheme';

export function AreaChartWidget({ widget }: { widget: AreaChartWidgetType }) {
  const { config, data } = widget;
  const series = React.useMemo(() => {
    return (
      (data as {
        series?: Array<{
          name: string;
          data: Array<{ x: string | number; y: number }>;
        }>;
      } | null)?.series ?? []
    );
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
      <div
        className="widget-content"
        role="img"
        aria-label={`Gráfico de área${config.title ? `: ${config.title}` : ''}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            {config.showGrid !== false && <CartesianGrid {...chartGridStyle} />}
            <XAxis
              dataKey="x"
              tick={chartAxisTickStyle}
              stroke="hsl(var(--color-border-hsl))"
            />
            <YAxis
              tick={chartAxisTickStyle}
              stroke="hsl(var(--color-border-hsl))"
            />
            <Tooltip
              contentStyle={chartTooltipContentStyle}
              itemStyle={chartTooltipItemStyle}
            />
            {config.showLegend !== false && <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />}
            {series.map((item, index) => (
              <Area
                key={item.name}
                type={config.smooth ? 'monotone' : 'linear'}
                dataKey={item.name}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                fillOpacity={0.16}
                strokeWidth={2}
                stackId={config.stacked ? '1' : undefined}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
