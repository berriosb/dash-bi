'use client';

import React from 'react';
import type { Widget } from '@/lib/widgets/types';
import { KPIWidget } from './KPIWidget';
import { LineChartWidget } from './LineChartWidget';
import { BarChartWidget } from './BarChartWidget';
import { PieChartWidget } from './PieChartWidget';
import { AreaChartWidget } from './AreaChartWidget';
import { ScatterWidget } from './ScatterWidget';
import { TableWidget } from './TableWidget';

export function WidgetRenderer({ widget }: { widget: Widget }) {
  if (!widget) return null;

  switch (widget.type) {
    case 'kpi':
      return <KPIWidget widget={widget} />;
    case 'line-chart':
      return <LineChartWidget widget={widget} />;
    case 'bar-chart':
      return <BarChartWidget widget={widget} />;
    case 'pie-chart':
      return <PieChartWidget widget={widget} />;
    case 'area-chart':
      return <AreaChartWidget widget={widget} />;
    case 'scatter':
      return <ScatterWidget widget={widget} />;
    case 'table':
      return <TableWidget widget={widget} />;
    default:
      return (
        <div className="p-4 bg-red-50 text-red-700 rounded-xl text-xs">
          Tipo de widget no soportado: {(widget as any).type}
        </div>
      );
  }
}
