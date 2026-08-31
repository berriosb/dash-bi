// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardEmbedView } from '@/components/dashboard/DashboardEmbedView';

const mockDashboard = {
  id: 'd-embed-test',
  orgId: 'o-embed-test',
  title: 'Dashboard Embebido de Prueba',
  description: 'Descripción de prueba',
  theme: 'moderno-saas',
  widgets: [
    {
      id: 'w-1',
      type: 'kpi' as const,
      position: { col: 1, row: 1, colSpan: 6, rowSpan: 2 },
      config: { title: 'Métrica Embebida', format: 'currency' },
      data: { value: 1250000 },
      source: {
        kind: 'query',
        dataSourceId: 'ds-1',
        query: { kind: 'sql', sql: 'SELECT 1250000 as value' },
      },
    },
  ],
};

describe('DashboardEmbedView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dashboard widgets without platform shell', () => {
    render(
      <DashboardEmbedView
        dashboard={mockDashboard}
        config={{
          theme: 'moderno-saas',
          hideTitle: false,
          allowExport: false,
          cspHeader: 'frame-ancestors *;',
        }}
      />
    );

    expect(screen.getByText('Dashboard Embebido de Prueba')).toBeDefined();
    expect(screen.getByText('Métrica Embebida')).toBeDefined();
  });

  it('hides dashboard title when hideTitle is true', () => {
    render(
      <DashboardEmbedView
        dashboard={mockDashboard}
        config={{
          theme: 'moderno-saas',
          hideTitle: true,
          allowExport: false,
          cspHeader: 'frame-ancestors *;',
        }}
      />
    );

    expect(screen.queryByText('Dashboard Embebido de Prueba')).toBeNull();
    expect(screen.getByText('Métrica Embebida')).toBeDefined();
  });

  it('emits postMessage to parent on render', () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

    render(
      <DashboardEmbedView
        dashboard={mockDashboard}
        config={{
          theme: 'corporate',
          hideTitle: false,
          allowExport: false,
          cspHeader: 'frame-ancestors *;',
        }}
      />
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dashbi:loaded',
        payload: expect.objectContaining({
          dashboardId: 'd-embed-test',
          title: 'Dashboard Embebido de Prueba',
        }),
      }),
      '*'
    );
  });
});
