'use client';

import React from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { ScatterWidget as ScatterWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

export function ScatterWidget({ widget }: { widget: ScatterWidgetType }) {
  const { config, data } = widget;
  const items = Array.isArray(data) ? data : [];

  return (
    <WidgetSurface widgetId={widget.id} title={config.title} isEmpty={items.length === 0}>
      <div className="widget-content" role="img" aria-label={`Gráfico de dispersión${config.title ? `: ${config.title}` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            {config.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--color-border))" />}
            <XAxis dataKey="x" name={config.xLabel || 'Eje X'} stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <YAxis dataKey="y" name={config.yLabel || 'Eje Y'} stroke="hsl(var(--color-text-muted))" fontSize={12} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Scatter name="Puntos" data={items} fill="hsl(var(--color-primary))" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </WidgetSurface>
  );
}
