// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { ExportShareDialog } from '@/components/dashboard/ExportShareDialog';

vi.mock('@/lib/export/client-export', () => ({
  exportDashboardPdf: vi.fn().mockResolvedValue({ success: true, filename: 'dashboard-test.pdf' }),
}));

describe('ExportShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ links: [] }),
    });
  });

  it('renders trigger button and opens dialog with PDF, PNG, and Share options', async () => {
    render(
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

    render(
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
});
