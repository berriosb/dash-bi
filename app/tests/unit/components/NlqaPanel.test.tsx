// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NlqaPanel } from '@/components/nlqa/NlqaPanel';
import { useDashboardStore } from '@/stores/dashboardStore';

describe('NlqaPanel Component', () => {
  beforeEach(() => {
    window.Element.prototype.scrollIntoView = vi.fn();
    useDashboardStore.setState({
      id: 'dash-1',
      title: 'Test Dashboard',
      description: '',
      theme: 'moderno-saas',
      widgets: [],
      archetype: 'custom',
    });
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <NlqaPanel dashboardId="dash-1" open={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders header and empty state when open is true', () => {
    render(<NlqaPanel dashboardId="dash-1" open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Preguntale a tus datos')).toBeDefined();
    expect(screen.getByText('Hacé tu primera pregunta')).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<NlqaPanel dashboardId="dash-1" open={true} onClose={onClose} />);
    const closeBtn = screen.getByRole('button', { name: 'Cerrar chat' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables input when dataSourceId is not provided', () => {
    render(<NlqaPanel dashboardId="dash-1" open={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Selecciona un data source primero') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('allows saving a chart suggestion as a widget to dashboardStore', () => {
    const onSave = vi.fn();
    render(
      <NlqaPanel
        dashboardId="dash-1"
        dataSourceId="ds-1"
        open={true}
        onClose={vi.fn()}
        onSaveAsWidget={onSave}
      />
    );
    expect(useDashboardStore.getState().widgets.length).toBe(0);
  });
});
