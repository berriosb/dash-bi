// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboards',
  useSearchParams: () => new URLSearchParams(),
}));

import { Sidebar } from '@/components/layout/Sidebar';
import AuthLayout from '@/app/(auth)/layout';
import HomePage from '@/app/page';
import { DashboardPublicView } from '@/components/dashboard/DashboardPublicView';
import { DashboardPrintView } from '@/components/dashboard/DashboardPrintView';

/**
 * El mark de dash-bi es "Escalones" variante 02. Estas superficies son
 * todas las que lo muestran, y cada una con la variante de color que
 * corresponde a su contexto.
 *
 * Este test existe para que nadie vuelva a poner las iniciales "db" en un
 * cuadrado: el mark es un asset de marca, no un placeholder.
 */
const MARK_PATH = 'path[d="M12 34V14H25V25H30"]';

const dashboard = {
  id: 'dash-1',
  orgId: 'org-1',
  title: 'Ventas',
  description: null,
  theme: 'moderno-saas',
  widgets: [],
};

describe('el mark de dash-bi en las superficies reales', () => {
  it('el sidebar muestra el mark junto al nombre', () => {
    const { container } = render(<Sidebar />);
    expect(container.querySelector(MARK_PATH)).not.toBeNull();
  });

  it('la cabecera de login muestra el mark', () => {
    const { container } = render(
      <AuthLayout>
        <p>formulario</p>
      </AuthLayout>,
    );
    expect(container.querySelector(MARK_PATH)).not.toBeNull();
  });

  it('la landing muestra el mark', () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector(MARK_PATH)).not.toBeNull();
  });

  it('la vista pública compartida muestra el mark', () => {
    const { container } = render(<DashboardPublicView dashboard={dashboard} />);
    expect(container.querySelector(MARK_PATH)).not.toBeNull();
  });

  it('el PDF exportado imprime el mark en la tinta del documento', () => {
    const { container } = render(<DashboardPrintView dashboard={dashboard} />);
    const node = container.querySelector('circle');

    expect(container.querySelector(MARK_PATH)).not.toBeNull();
    // La vista de impresión es monocroma a propósito: hereda el color del
    // texto (negro) en vez del token de la app.
    expect(node?.style.fill).toBe('currentColor');
  });
});
