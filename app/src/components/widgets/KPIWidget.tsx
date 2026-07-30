'use client';

import React from 'react';
import type { KPIWidget as KPIWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

export function KPIWidget({ widget }: { widget: KPIWidgetType }) {
  const { config, data } = widget;
  const kpiData = data as { value?: number; delta?: { value?: number; percent?: number; isPositive?: boolean } } | null;
  const hasValue = typeof kpiData?.value === 'number' && Number.isFinite(kpiData.value);
  const value = hasValue ? kpiData.value! : 0;
  const delta = kpiData?.delta;

  const formattedValue = React.useMemo(() => {
    if (config.format === 'currency') {
      return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(value);
    }
    if (config.format === 'percent') {
      return new Intl.NumberFormat('es-CL', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(value / 100);
    }
    return new Intl.NumberFormat('es-CL').format(value);
  }, [value, config.format]);

  return (
    <WidgetSurface
      widgetId={widget.id}
      title={config.title}
      isEmpty={!hasValue}
      emptyMessage="La consulta no devolvió un valor para esta métrica."
    >
      <div className="widget-kpi-value">{formattedValue}</div>
      {config.showDelta !== false && typeof delta === 'number' && Number.isFinite(delta) && (
        <div
          className="widget-kpi-delta"
          data-direction={delta >= 0 ? 'positive' : 'negative'}
        >
          <span aria-hidden="true">{delta >= 0 ? '↑' : '↓'}</span>
          <span>{Math.abs(delta).toFixed(1)}% vs período anterior</span>
        </div>
      )}
    </WidgetSurface>
  );
}
