'use client';

import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import type { PieChartWidget as PieChartWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

export function PieChartWidget({ widget }: { widget: PieChartWidgetType }) {
  const { config, data } = widget;
  const items = Array.isArray(data) ? data : [];
  const colors = ['hsl(var(--color-primary))', 'hsl(var(--color-secondary))', 'hsl(var(--color-success))', 'hsl(var(--color-warning))', 'hsl(var(--color-accent))', 'hsl(var(--color-accent))'];

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={items.length === 0}>
      <div className="widget-content" role="img" aria-label={`Distribución${config.title ? `: ${config.title}` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            {config.showLegend !== false && <Legend />}
            <Pie data={items} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={config.variant === 'pie' ? 0 : 50} outerRadius={80} paddingAngle={2}>
              {items.map((entry, index) => <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
