// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportDashboardPdf } from '@/lib/export/client-export';

describe('exportDashboardPdf (Client-side Polling Engine)', () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let mockCreateObjectURL: ReturnType<typeof vi.fn>;
  let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
  let mockAnchorClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-blob-url');
    mockRevokeObjectURL = vi.fn();
    mockAnchorClick = vi.fn();

    URL.createObjectURL = mockCreateObjectURL;
    URL.revokeObjectURL = mockRevokeObjectURL;

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(mockAnchorClick);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('enqueues PDF, polls until completed, and triggers file download', async () => {
    const progressSteps: string[] = [];
    const mockFetch = vi
      .fn()
      // Step 1: POST /api/dashboards/dash-1/export/pdf -> 202 queued
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-123', status: 'queued' }),
      })
      // Step 2: GET poll attempt 1 -> active
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'active' }),
      })
      // Step 3: GET poll attempt 2 -> completed (binary PDF)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="dashboard-dash-1.pdf"',
        }),
        blob: async () => new Blob(['%PDF-1.4 Mock PDF Content'], { type: 'application/pdf' }),
      });

    global.fetch = mockFetch;

    const result = await exportDashboardPdf('dash-1', {
      pageSize: 'A4',
      filename: 'Reporte Trimestral',
      pollIntervalMs: 5,
      onProgress: (p) => progressSteps.push(p),
    });

    expect(result.success).toBe(true);
    expect(result.filename).toBe('Reporte Trimestral.pdf');
    expect(progressSteps).toContain('queued');
    expect(progressSteps).toContain('generating');
    expect(progressSteps).toContain('downloading');
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(mockAnchorClick).toHaveBeenCalledTimes(1);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob-url');
  });

  it('throws a descriptive error when worker reports job failure', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-err', status: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'failed', reason: 'Puppeteer render timeout after 30s' }),
      });

    global.fetch = mockFetch;

    await expect(
      exportDashboardPdf('dash-1', {
        pollIntervalMs: 5,
      })
    ).rejects.toThrow('Puppeteer render timeout after 30s');
  });

  it('throws an error when HTTP POST enqueuing fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ message: 'No tienes permiso para exportar PDF' }),
    });

    await expect(exportDashboardPdf('dash-1')).rejects.toThrow(
      'No tienes permiso para exportar PDF'
    );
  });
});
