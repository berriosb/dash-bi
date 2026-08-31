// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { KPIWidget } from '@/components/widgets/KPIWidget';
import type { KPIWidget as KPIWidgetType } from '@/lib/widgets/types';

describe('KPIWidget', () => {
  const baseWidget: KPIWidgetType = {
    id: 'widget-kpi-1',
    type: 'kpi',
    position: { col: 1, row: 1, colSpan: 3, rowSpan: 2 },
    config: {
      title: 'Ingresos Totales',
      format: 'currency',
      showDelta: true,
      comparisonPeriod: 'previous',
    },
    data: {
      value: 1500000,
      delta: 12.5,
    },
    source: {
      kind: 'query',
      dataSourceId: 'ds-1',
      query: { kind: 'sql', sql: 'SELECT 1500000 as value' },
    },
  };

  it('renders currency value formatted in CLP and numeric delta', () => {
    render(<KPIWidget widget={baseWidget} />);

    expect(screen.getByText('Ingresos Totales')).toBeDefined();
    expect(screen.getByText(/\$?\s*1\.500\.000/)).toBeDefined();
    expect(screen.getByText(/12\.5%\s+vs período anterior/)).toBeDefined();
  });

  it('renders structured object delta with percent', () => {
    const widget: KPIWidgetType = {
      ...baseWidget,
      data: {
        value: 250000,
        delta: { percent: -4.3, isPositive: false },
      },
    };

    render(<KPIWidget widget={widget} />);

    expect(screen.getByText(/4\.3%\s+vs período anterior/)).toBeDefined();
    const deltaEl = document.querySelector('.widget-kpi-delta');
    expect(deltaEl?.getAttribute('data-direction')).toBe('negative');
  });

  it('renders custom comparisonPeriod label', () => {
    const widget: KPIWidgetType = {
      ...baseWidget,
      config: {
        ...baseWidget.config,
        comparisonPeriod: 'last_year',
      },
      data: {
        value: 100000,
        delta: 20.0,
      },
    };

    render(<KPIWidget widget={widget} />);

    expect(screen.getByText(/20\.0%\s+vs año anterior/)).toBeDefined();
  });

  it('renders percentage formatted value when config.format is percent', () => {
    const widget: KPIWidgetType = {
      ...baseWidget,
      config: {
        ...baseWidget.config,
        format: 'percent',
      },
      data: {
        value: 85.5,
        delta: 1.2,
      },
    };

    render(<KPIWidget widget={widget} />);

    expect(screen.getByText(/85,5\s*%/)).toBeDefined();
  });

  it('hides delta when config.showDelta is false', () => {
    const widget: KPIWidgetType = {
      ...baseWidget,
      config: {
        ...baseWidget.config,
        showDelta: false,
      },
    };

    render(<KPIWidget widget={widget} />);

    const deltaEl = document.querySelector('.widget-kpi-delta');
    expect(deltaEl).toBeNull();
  });

  it('renders empty state when value is missing', () => {
    const widget: KPIWidgetType = {
      ...baseWidget,
      data: null,
    };

    render(<KPIWidget widget={widget} />);

    expect(screen.getByText('La consulta no devolvió un valor para esta métrica.')).toBeDefined();
  });

  it('applies tabular-nums class for stable number rendering', () => {
    render(<KPIWidget widget={baseWidget} />);

    const valueEl = document.querySelector('.widget-kpi-value');
    expect(valueEl?.classList.contains('tabular-nums')).toBe(true);

    const deltaEl = document.querySelector('.widget-kpi-delta');
    expect(deltaEl?.classList.contains('tabular-nums')).toBe(true);
  });
});
