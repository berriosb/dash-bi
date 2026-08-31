// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DemoDashboardViewer } from '@/components/demo/DemoDashboardViewer';

describe('DemoDashboardViewer', () => {
  it('renders SaaS preset by default with Modo Demo badge', () => {
    render(<DemoDashboardViewer />);

    expect(screen.getByText('Modo Demo')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Ingresos y rendimiento' })).toBeDefined();
    expect(screen.getByText('Crear mi dashboard gratis')).toBeDefined();
  });

  it('switches to E-commerce preset when clicked', () => {
    render(<DemoDashboardViewer />);

    const ecomBtn = screen.getByRole('button', { name: 'E-commerce / Retail' });
    fireEvent.click(ecomBtn);

    expect(screen.getByRole('heading', { name: 'Ventas y Operaciones E-commerce' })).toBeDefined();
    expect(screen.getByText('Top Productos del Mes')).toBeDefined();
  });

  it('switches to Agency preset when clicked', () => {
    render(<DemoDashboardViewer />);

    const agencyBtn = screen.getByRole('button', { name: 'Agencia / Marketing' });
    fireEvent.click(agencyBtn);

    expect(screen.getByRole('heading', { name: 'Rendimiento de Marketing y Clientes' })).toBeDefined();
    expect(screen.getByText('Inversión Publicitaria')).toBeDefined();
  });

  it('toggles theme when theme button is clicked', () => {
    render(<DemoDashboardViewer />);

    const themeBtn = screen.getByTitle('Alternar tema visual');
    expect(screen.getByText(/Tema: Moderno/)).toBeDefined();

    fireEvent.click(themeBtn);
    expect(screen.getByText(/Tema: Corporate/)).toBeDefined();
  });
});
