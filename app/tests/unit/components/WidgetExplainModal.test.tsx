// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { WidgetExplainModal } from '@/components/widgets/WidgetExplainModal';

describe('WidgetExplainModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <WidgetExplainModal
        isOpen={false}
        onClose={vi.fn()}
        widgetTitle="Ingresos Netos"
        widgetType="kpi"
        widgetData={{ value: 1000 }}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('displays loading state and then renders explanation upon successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        headline: 'Aumento del 15% por contratos corporativos',
        summary: 'Los ingresos crecieron sostenidamente debido a la captación enterprise.',
        trend: 'upward',
        keyDrivers: [
          { label: 'Cuentas Enterprise', impact: 'positive', detail: '3 nuevos cierres clave.' },
          { label: 'Tasa de retención', impact: 'neutral', detail: 'Sin cambios relevantes en churn.' },
        ],
        suggestedAction: 'Fortalecer el onboarding de nuevas cuentas.',
      }),
    });

    render(
      <WidgetExplainModal
        isOpen={true}
        onClose={vi.fn()}
        widgetTitle="Ingresos Netos"
        widgetType="kpi"
        widgetData={{ value: 1000 }}
        context={{ dashboardTitle: 'Ventas Q3' }}
      />
    );

    // Initial loading indicator
    expect(screen.getByText(/analizando/i)).toBeDefined();

    // Wait for explanation content
    await waitFor(() => {
      expect(screen.getByText('Aumento del 15% por contratos corporativos')).toBeDefined();
    });

    expect(screen.getByText(/3 nuevos cierres clave/i)).toBeDefined();
    expect(screen.getByText(/fortalecer el onboarding/i)).toBeDefined();
    expect(screen.getByText(/crecimiento/i)).toBeDefined();
  });

  it('calls onClose when close button or backdrop is clicked', async () => {
    const onClose = vi.fn();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        headline: 'Métrica estable',
        summary: 'Sin variaciones notorias.',
        trend: 'stable',
        keyDrivers: [],
        suggestedAction: 'Mantener monitoreo regular.',
      }),
    });

    render(
      <WidgetExplainModal
        isOpen={true}
        onClose={onClose}
        widgetTitle="Tasa de Churn"
        widgetType="kpi"
        widgetData={{ value: 2 }}
      />
    );

    const closeBtn = screen.getByLabelText(/cerrar/i);
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
