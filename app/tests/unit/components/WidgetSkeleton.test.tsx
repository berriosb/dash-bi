// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  WidgetSkeleton,
  KPISkeleton,
  ChartSkeleton,
  TableSkeleton,
  DashboardGridSkeleton,
} from '@/components/widgets/WidgetSkeleton';

describe('WidgetSkeleton', () => {
  it('renders KPISkeleton with aria-busy and title', () => {
    render(<KPISkeleton title="Ventas Mensuales" />);

    expect(screen.getByText('Ventas Mensuales')).toBeDefined();
    const skeleton = document.querySelector('.widget-skeleton');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders ChartSkeleton for pie and bar/line charts', () => {
    const { rerender } = render(<ChartSkeleton title="Evolución" type="line-chart" />);
    expect(screen.getByText('Evolución')).toBeDefined();
    expect(document.querySelector('.widget-skeleton-bars')).toBeDefined();

    rerender(<ChartSkeleton title="Distribución" type="pie-chart" />);
    expect(screen.getByText('Distribución')).toBeDefined();
    expect(document.querySelector('.widget-skeleton-pie-wrapper')).toBeDefined();
  });

  it('renders TableSkeleton with column headers and rows', () => {
    render(<TableSkeleton title="Transacciones" />);
    expect(screen.getByText('Transacciones')).toBeDefined();
    const rows = document.querySelectorAll('.widget-skeleton-table-row');
    expect(rows.length).toBe(4);
  });

  it('renders WidgetSkeleton dispatching by type', () => {
    const { rerender } = render(<WidgetSkeleton type="kpi" title="KPI Test" />);
    expect(screen.getByText('KPI Test')).toBeDefined();

    rerender(<WidgetSkeleton type="table" title="Table Test" />);
    expect(screen.getByText('Table Test')).toBeDefined();
  });

  it('renders DashboardGridSkeleton with hero-focus layout', () => {
    render(<DashboardGridSkeleton archetype="hero-focus" />);
    expect(screen.getByText('Métrica Principal')).toBeDefined();
    expect(screen.getByText('Evolución Temporal')).toBeDefined();
    expect(screen.getByText('Detalle Operacional')).toBeDefined();
  });
});
