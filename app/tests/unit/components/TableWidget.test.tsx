// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { TableWidget } from '@/components/widgets/TableWidget';
import type { TableWidget as TableWidgetType } from '@/lib/widgets/types';

describe('TableWidget', () => {
  const baseTableWidget: TableWidgetType = {
    id: 'widget-tbl-1',
    type: 'table',
    position: { col: 1, row: 1, colSpan: 12, rowSpan: 3 },
    config: {
      title: 'Ventas por Región',
      columns: [
        { key: 'region', label: 'Región', format: 'text', align: 'left' },
        { key: 'ventas', label: 'Ventas', format: 'currency', align: 'right' },
        { key: 'margen', label: 'Margen', format: 'percent', align: 'right' },
      ],
    },
    data: [
      { region: 'Metropolitana', ventas: 4500000, margen: 0.245 },
      { region: 'Valparaíso', ventas: 1200000, margen: 0.18 },
    ],
    source: {
      kind: 'query',
      dataSourceId: 'ds-1',
      query: { kind: 'sql', sql: 'SELECT * FROM sales' },
    },
  };

  it('renders headers and formatted table cells with tabular-nums', () => {
    render(<TableWidget widget={baseTableWidget} />);

    expect(screen.getByText('Ventas por Región')).toBeDefined();
    expect(screen.getByText('Región')).toBeDefined();
    expect(screen.getByText('Ventas')).toBeDefined();
    expect(screen.getByText('Margen')).toBeDefined();

    expect(screen.getByText('Metropolitana')).toBeDefined();
    expect(screen.getByText(/\$?\s*4\.500\.000/)).toBeDefined();
    expect(screen.getByText(/24,5\s*%/)).toBeDefined();

    const numericCells = document.querySelectorAll('td.tabular-nums');
    expect(numericCells.length).toBe(4);
  });

  it('renders empty state when data is empty array', () => {
    const emptyWidget: TableWidgetType = {
      ...baseTableWidget,
      data: [],
    };

    render(<TableWidget widget={emptyWidget} />);

    expect(screen.getByText('La consulta no devolvió filas para mostrar.')).toBeDefined();
  });

  it('infers columns automatically when not defined in config', () => {
    const inferredWidget: TableWidgetType = {
      ...baseTableWidget,
      config: {
        title: 'Sin Columnas Predefinidas',
        columns: [],
      },
      data: [{ producto: 'Widget A', stock: 50 }],
    };

    render(<TableWidget widget={inferredWidget} />);

    expect(screen.getByText('producto')).toBeDefined();
    expect(screen.getByText('stock')).toBeDefined();
    expect(screen.getByText('Widget A')).toBeDefined();
    expect(screen.getByText('50')).toBeDefined();
  });
});
