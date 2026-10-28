// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { ExportShareDialog } from '@/components/dashboard/ExportShareDialog';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/lib/export/client-export', () => ({
  exportDashboardPdf: vi.fn().mockResolvedValue({ success: true, filename: 'dashboard-test.pdf' }),
}));

/**
 * El diálogo consulta el rol del usuario en la organización activa, así que
 * necesita un QueryClient. La query comparte la clave `["my-orgs"]` con el
 * OrgSwitcher del header: en la app real ya está en caché cuando el
 * dashboard monta.
 */
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, ui),
  );
}

function mockOrgsFetch(role: string) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/api/organizations')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          organizations: [
            { id: 'org-1', name: 'Org', slug: 'org', plan: 'pro', role },
          ],
          activeOrgId: 'org-1',
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ links: [] }),
    });
  });
}

describe('ExportShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ activeOrgId: null });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ links: [] }),
    });
  });

  it('renders trigger button and opens dialog with PDF, PNG, and Share options', async () => {
    renderWithProviders(
      <ExportShareDialog
        dashboardId="dash-123"
        dashboardTitle="Ventas Q3"
      />
    );

    const trigger = screen.getByRole('button', { name: /exportar & compartir/i });
    expect(trigger).toBeDefined();

    fireEvent.click(trigger);

    expect(screen.getByRole('heading', { name: 'Exportar & Compartir' })).toBeDefined();
    expect(screen.getByRole('tab', { name: /pdf/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /png/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /enlace público/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /embeber/i })).toBeDefined();
  });

  it('switches between tabs and allows generating public share links', async () => {
    const mockPostFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            url: 'http://localhost:3000/share/token-xyz',
            token: 'token-xyz',
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ links: [] }),
      });
    });

    global.fetch = mockPostFetch;

    renderWithProviders(
      <ExportShareDialog
        dashboardId="dash-123"
        dashboardTitle="Ventas Q3"
        defaultOpen={true}
      />
    );

    const shareTab = screen.getByRole('tab', { name: /enlace público/i });
    fireEvent.click(shareTab);

    const generateBtn = screen.getByRole('button', { name: /generar enlace público/i });
    expect(generateBtn).toBeDefined();

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(mockPostFetch).toHaveBeenCalledWith(
        '/api/dashboards/dash-123/share',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('allows generating iframe embed snippet in the embed tab', async () => {
    const mockEmbedFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/embed') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            token: 'emb_123456',
            embedUrl: 'http://localhost:3000/embed/emb_123456',
            iframeSnippet: '<iframe src="http://localhost:3000/embed/emb_123456" width="100%"></iframe>',
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ links: [] }),
      });
    });

    global.fetch = mockEmbedFetch;

    renderWithProviders(
      <ExportShareDialog
        dashboardId="dash-123"
        dashboardTitle="Ventas Q3"
        defaultOpen={true}
      />
    );

    const embedTab = screen.getByRole('tab', { name: /embeber/i });
    fireEvent.click(embedTab);

    const generateBtn = screen.getByRole('button', { name: /generar código iframe/i });
    expect(generateBtn).toBeDefined();

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(mockEmbedFetch).toHaveBeenCalledWith(
        '/api/dashboards/dash-123/embed',
        expect.objectContaining({ method: 'POST' })
      );
      expect(screen.getByText(/<iframe/)).toBeDefined();
    });
  });

  /**
   * El backend responde 403 a un viewer en `POST /api/dashboards/:id/export/pdf`
   * (`export.pdf` es de editor). Antes de esto, la UI mostraba igual el
   * botón: el usuario descubría el permiso por la vía del error.
   */
  describe('gate por rol', () => {
    it('no muestra el botón a un viewer', async () => {
      mockOrgsFetch('viewer');

      renderWithProviders(
        <ExportShareDialog dashboardId="dash-123" dashboardTitle="Ventas Q3" />
      );

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /exportar & compartir/i })).toBeNull();
      });
    });

    it('muestra el botón a un editor', async () => {
      mockOrgsFetch('editor');

      renderWithProviders(
        <ExportShareDialog dashboardId="dash-123" dashboardTitle="Ventas Q3" />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /exportar & compartir/i })).toBeDefined();
      });
    });

    it('muestra el botón a un admin', async () => {
      mockOrgsFetch('admin');

      renderWithProviders(
        <ExportShareDialog dashboardId="dash-123" dashboardTitle="Ventas Q3" />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /exportar & compartir/i })).toBeDefined();
      });
    });

    it('mantiene el botón cuando no hay sesión (demo público)', async () => {
      // Sin sesión, `/api/organizations` falla: el rol es desconocido y la
      // superficie se conserva (el backend responde 401). Lo que no puede
      // pasar es que un viewer conocido vea el botón.
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/organizations')) {
          return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ links: [] }),
        });
      });

      renderWithProviders(
        <ExportShareDialog dashboardId="demo" dashboardTitle="Demo" />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /exportar & compartir/i })).toBeDefined();
      });
    });

    it('mantiene el botón mientras el rol todavía no se resolvió', () => {
      // Fail-open mientras el rol es desconocido: ocultarlo en esa ventana
      // lo haría parpadear en cada carga de dashboard, para todos los roles
      // (incluidos los que sí pueden exportar).
      global.fetch = vi.fn(() => new Promise<Response>(() => {}));

      renderWithProviders(
        <ExportShareDialog dashboardId="dash-123" dashboardTitle="Ventas Q3" />
      );

      expect(screen.getByRole('button', { name: /exportar & compartir/i })).toBeDefined();
    });
  });
});
