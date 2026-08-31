'use client';

import React from 'react';
import type { KPIWidget as KPIWidgetType } from '@/lib/widgets/types';
import { WidgetSurface } from './WidgetSurface';

export function KPIWidget({ widget }: { widget: KPIWidgetType }) {
  const { config, data } = widget;
  const kpiData = data as {
    value?: number;
    delta?: number | { value?: number; percent?: number; isPositive?: boolean };
  } | null;

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

  const deltaInfo = React.useMemo(() => {
    if (delta === undefined || delta === null) return null;

    if (typeof delta === 'number' && Number.isFinite(delta)) {
      return {
        numeric: delta,
        formatted: `${Math.abs(delta).toFixed(1)}%`,
        isPositive: delta >= 0,
      };
    }

    if (typeof delta === 'object') {
      if (typeof delta.percent === 'number' && Number.isFinite(delta.percent)) {
        return {
          numeric: delta.percent,
          formatted: `${Math.abs(delta.percent).toFixed(1)}%`,
          isPositive: delta.isPositive ?? delta.percent >= 0,
        };
      }
      if (typeof delta.value === 'number' && Number.isFinite(delta.value)) {
        const sign = delta.value >= 0 ? '+' : '-';
        return {
          numeric: delta.value,
          formatted: `${sign}${Math.abs(delta.value)}`,
          isPositive: delta.isPositive ?? delta.value >= 0,
        };
      }
    }

    return null;
  }, [delta]);

  const periodLabel = React.useMemo(() => {
    switch (config.comparisonPeriod) {
      case 'last_year':
        return 'vs año anterior';
      case 'last_month':
        return 'vs mes anterior';
      case 'last_week':
        return 'vs semana anterior';
      case 'previous':
      default:
        return 'vs período anterior';
    }
  }, [config.comparisonPeriod]);

  return (
    <WidgetSurface
      widgetId={widget.id}
      title={config.title}
      isEmpty={!hasValue}
      emptyMessage="La consulta no devolvió un valor para esta métrica."
    >
      <div className="widget-kpi-value tabular-nums">{formattedValue}</div>
      {config.showDelta !== false && deltaInfo !== null && (
        <div
          className="widget-kpi-delta tabular-nums"
          data-direction={deltaInfo.isPositive ? 'positive' : 'negative'}
        >
          <span aria-hidden="true">{deltaInfo.isPositive ? '↑' : '↓'}</span>
          <span>
            {deltaInfo.formatted} {periodLabel}
          </span>
        </div>
      )}
    </WidgetSurface>
  );
}
