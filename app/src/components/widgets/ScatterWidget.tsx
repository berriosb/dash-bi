'use client';

import React from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type { ScatterWidget as ScatterWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';
import {
  CHART_COLORS,
  chartTooltipContentStyle,
  chartTooltipItemStyle,
  chartAxisTickStyle,
  chartGridStyle,
} from './chartTheme';

export function ScatterWidget({ widget }: { widget: ScatterWidgetType }) {
  const { config, data } = widget;
  const items = Array.isArray(data) ? data : [];

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={items.length === 0}>
      <div
        className="widget-content"
        role="img"
        aria-label={`Gráfico de dispersión${config.title ? `: ${config.title}` : ''}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            {config.showGrid !== false && <CartesianGrid {...chartGridStyle} />}
            <XAxis
              dataKey="x"
              name={config.xLabel || 'Eje X'}
              tick={chartAxisTickStyle}
              stroke="hsl(var(--color-border-hsl))"
            />
            <YAxis
              dataKey="y"
              name={config.yLabel || 'Eje Y'}
              tick={chartAxisTickStyle}
              stroke="hsl(var(--color-border-hsl))"
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: 'hsl(var(--color-text-muted-hsl))' }}
              contentStyle={chartTooltipContentStyle}
              itemStyle={chartTooltipItemStyle}
            />
            <Scatter name="Puntos" data={items} fill={CHART_COLORS[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
