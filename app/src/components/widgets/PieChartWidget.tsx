'use client';

import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import type { PieChartWidget as PieChartWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';
import {
  CHART_COLORS,
  chartTooltipContentStyle,
  chartTooltipItemStyle,
} from './chartTheme';

export function PieChartWidget({ widget }: { widget: PieChartWidgetType }) {
  const { config, data } = widget;
  const items = Array.isArray(data) ? data : [];

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={items.length === 0}>
      <div
        className="widget-content"
        role="img"
        aria-label={`Distribución${config.title ? `: ${config.title}` : ''}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={chartTooltipContentStyle}
              itemStyle={chartTooltipItemStyle}
            />
            {config.showLegend !== false && <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />}
            <Pie
              data={items}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={config.variant === 'pie' ? 0 : 45}
              outerRadius={75}
              paddingAngle={2}
            >
              {items.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                  stroke="hsl(var(--color-surface-hsl))"
                  strokeWidth={2}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
