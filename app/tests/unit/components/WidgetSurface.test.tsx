// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { WidgetSurface } from '@/components/widgets/WidgetSurface';

describe('WidgetSurface', () => {
  it('renders title and children correctly', () => {
    render(
      <WidgetSurface widgetId="w-1" title="Ventas Totales">
        <div>Contenido del gráfico</div>
      </WidgetSurface>
    );

    expect(screen.getByText('Ventas Totales')).toBeDefined();
    expect(screen.getByText('Contenido del gráfico')).toBeDefined();
  });

  it('renders "Explicar" button when title is present and not loading/empty', () => {
    render(
      <WidgetSurface widgetId="w-1" title="Ventas Totales" widgetData={{ value: 100 }}>
        <div>Contenido del gráfico</div>
      </WidgetSurface>
    );

    const button = screen.getByRole('button', { name: /explicar métrica de ventas totales/i });
    expect(button).toBeDefined();
  });

  it('does not render "Explicar" button when loading or empty or disabled', () => {
    const { rerender } = render(
      <WidgetSurface widgetId="w-1" title="Ventas Totales" isLoading={true}>
        <div>Contenido</div>
      </WidgetSurface>
    );
    expect(screen.queryByRole('button', { name: /explicar/i })).toBeNull();

    rerender(
      <WidgetSurface widgetId="w-1" title="Ventas Totales" isEmpty={true}>
        <div>Contenido</div>
      </WidgetSurface>
    );
    expect(screen.queryByRole('button', { name: /explicar/i })).toBeNull();

    rerender(
      <WidgetSurface widgetId="w-1" title="Ventas Totales" showExplain={false}>
        <div>Contenido</div>
      </WidgetSurface>
    );
    expect(screen.queryByRole('button', { name: /explicar/i })).toBeNull();
  });

  it('calls onExplain when provided and clicked', () => {
    const onExplain = vi.fn();
    render(
      <WidgetSurface
        widgetId="w-1"
        title="Ventas Totales"
        widgetData={{ value: 100 }}
        onExplain={onExplain}
      >
        <div>Contenido</div>
      </WidgetSurface>
    );

    const button = screen.getByRole('button', { name: /explicar métrica de ventas totales/i });
    fireEvent.click(button);
    expect(onExplain).toHaveBeenCalledOnce();
  });
});
