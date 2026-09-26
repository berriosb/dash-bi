// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { FileUploadModal } from '@/components/datasources/FileUploadModal';

describe('FileUploadModal Component', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <FileUploadModal open={false} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders upload dropzone when open is true', () => {
    render(
      <FileUploadModal open={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );
    expect(screen.getByText('Cargar Archivo CSV o Excel')).toBeDefined();
    expect(screen.getByText(/Arrastrá tu archivo acá/i)).toBeDefined();
  });

  it('calls onClose when cancel button is clicked', () => {
    render(
      <FileUploadModal open={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );
    const cancelBtn = screen.getByRole('button', { name: /Cancelar/i });
    fireEvent.click(cancelBtn);
    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('handles successful file upload and displays preview table and column types', async () => {
    const mockUploadResponse = {
      fileId: 'file-123',
      name: 'ventas_2026.csv',
      format: 'csv',
      sizeBytes: 1024,
      proposedTargetTable: 'org_abc_ventas_2026',
      inferredColumns: [
        { name: 'fecha', type: 'date', nullable: false, samples: ['2026-01-01'] },
        { name: 'monto', type: 'number', nullable: false, samples: [15000] },
        { name: 'cliente', type: 'string', nullable: true, samples: ['Acme Corp'] },
      ],
      previewRows: [
        { fecha: '2026-01-01', monto: 15000, cliente: 'Acme Corp' },
      ],
      totalRows: 1,
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/files/upload') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockUploadResponse),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(
      <FileUploadModal open={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['fecha,monto,cliente\n2026-01-01,15000,Acme Corp'], 'ventas_2026.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Previsualización y Tipos de Columna')).toBeDefined();
    });

    expect(screen.getByDisplayValue('ventas_2026')).toBeDefined();
    expect(screen.getAllByText('fecha').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('monto').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('cliente').length).toBeGreaterThanOrEqual(1);
  });

  it('submits commit request with configured columns and calls onSuccess', async () => {
    const mockUploadResponse = {
      fileId: 'file-123',
      name: 'ventas_2026.csv',
      format: 'csv',
      sizeBytes: 1024,
      proposedTargetTable: 'org_abc_ventas_2026',
      inferredColumns: [
        { name: 'monto', type: 'string', nullable: false, samples: ['15000'] },
      ],
      previewRows: [{ monto: '15000' }],
      totalRows: 1,
    };

    const mockCommitResponse = {
      dataSourceId: 'ds-file-123',
      fileId: 'file-123',
      targetTable: 'org_abc_ventas_2026',
      rowCount: 1,
    };

    global.fetch = vi.fn().mockImplementation((url: string, _opts?: RequestInit) => {
      if (url === '/api/files/upload') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockUploadResponse),
        });
      }
      if (url === '/api/files/commit') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCommitResponse),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(
      <FileUploadModal open={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    const fileInput = screen.getByTestId('file-input');
    const file = new File(['monto\n15000'], 'ventas_2026.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Previsualización y Tipos de Columna')).toBeDefined();
    });

    // Change column type from string to number
    const typeSelect = screen.getByTestId('column-type-monto') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'number' } });

    const confirmBtn = screen.getByRole('button', { name: /Confirmar e Importar/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledOnce();
    });

    const commitCall = vi.mocked(global.fetch).mock.calls.find(([url]) => url === '/api/files/commit');
    expect(commitCall).toBeDefined();
    const commitBody = JSON.parse(commitCall![1]!.body as string);
    expect(commitBody).toMatchObject({
      fileId: 'file-123',
      name: 'ventas_2026',
      columns: [{ name: 'monto', type: 'number', nullable: false }],
    });
  });
});
