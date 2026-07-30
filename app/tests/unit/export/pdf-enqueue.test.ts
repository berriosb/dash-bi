import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueueAdd, mockQueueGetJob, mockGeneratePrintToken, mockGetOrgBranding } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockQueueGetJob: vi.fn(),
  mockGeneratePrintToken: vi.fn().mockResolvedValue('print-token-aaaaaaaaaaaaaaaaaaaa'),
  mockGetOrgBranding: vi.fn().mockResolvedValue({ logoUrl: 'https://cdn/logo.png' }),
}));

const mockQueueInstance = {
  add: mockQueueAdd,
  getJob: mockQueueGetJob,
};

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueueInstance),
}));

vi.mock('@/lib/export/print-token', () => ({
  generatePrintToken: mockGeneratePrintToken,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/export/branding', () => ({
  getOrgBranding: mockGetOrgBranding,
}));

import { enqueuePdfExport, getPdfJobStatus } from '@/lib/export/pdf-enqueue';

describe('pdf-enqueue', () => {
  beforeEach(() => {
    // clearAllMocks preserves constructor `mockReturnValue` from `vi.hoisted`,
    // so `Queue()` keeps returning `mockQueueInstance`. We then clear the
    // per-test setup manually for `mockResolvedValueOnce` queues.
    vi.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'job-123' });
    mockGeneratePrintToken.mockResolvedValue('print-token-aaaaaaaaaaaaaaaaaaaa');
    mockGetOrgBranding.mockResolvedValue({ logoUrl: 'https://cdn/logo.png' });
  });

  describe('enqueuePdfExport', () => {
    it('adds a render job with url, options, branding payload', async () => {
      const jobId = await enqueuePdfExport({
        dashboardId: 'dash-1',
        orgId: 'org-1',
        userId: 'user-1',
        pageSize: 'A4',
      });

      expect(jobId).toBe('job-123');
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      const firstCall = mockQueueAdd.mock.calls[0];
      expect(firstCall).toBeDefined();
      const [jobName, payload, opts] = firstCall!;
      expect(jobName).toBe('render');
      expect(payload).toMatchObject({
        url: expect.stringContaining('/dashboard/dash-1/print?token=print-token-aaaaaaaaaaaaaaaaaaaa'),
        options: { pageSize: 'A4' },
        branding: { logoUrl: 'https://cdn/logo.png' },
      });
      expect(opts).toMatchObject({
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    });

    it('defaults pageSize to Letter when not provided', async () => {
      await enqueuePdfExport({
        dashboardId: 'dash-1',
        orgId: 'org-1',
        userId: 'user-1',
      });
      const firstCall = mockQueueAdd.mock.calls[0];
      const payload = firstCall![1] as { options: { pageSize: string } };
      expect(payload.options.pageSize).toBe('Letter');
    });

    it('passes branding logoUrl through from getOrgBranding', async () => {
      mockGetOrgBranding.mockResolvedValueOnce({ logoUrl: 'https://other/logo.svg' });

      await enqueuePdfExport({
        dashboardId: 'dash-1',
        orgId: 'org-1',
        userId: 'user-1',
      });

      const firstCall = mockQueueAdd.mock.calls[0];
      const payload = firstCall![1] as { branding: { logoUrl: string } };
      expect(payload.branding.logoUrl).toBe('https://other/logo.svg');
    });
  });

  describe('getPdfJobStatus', () => {
    it('returns not_found when job does not exist', async () => {
      mockQueueGetJob.mockResolvedValueOnce(null);
      const result = await getPdfJobStatus('missing');
      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns active state when job is still queued', async () => {
      mockQueueGetJob.mockResolvedValueOnce({
        isCompleted: async () => false,
        isFailed: async () => false,
        getState: async () => 'active',
        returnvalue: undefined,
      });
      const result = await getPdfJobStatus('job-1');
      expect(result).toEqual({ status: 'active' });
    });

    it('returns completed with buffer when job finished', async () => {
      const fakeBuffer = Buffer.from('PDF-BYTES');
      mockQueueGetJob.mockResolvedValueOnce({
        isCompleted: async () => true,
        isFailed: async () => false,
        getState: async () => 'completed',
        returnvalue: { buffer: fakeBuffer },
      });
      const result = await getPdfJobStatus('job-1');
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.buffer).toBe(fakeBuffer);
      }
    });

    it('returns failed with reason when job failed', async () => {
      mockQueueGetJob.mockResolvedValueOnce({
        isCompleted: async () => false,
        isFailed: async () => true,
        getState: async () => 'failed',
        failedReason: 'puppeteer timeout',
        returnvalue: undefined,
      });
      const result = await getPdfJobStatus('job-1');
      expect(result).toEqual({ status: 'failed', reason: 'puppeteer timeout' });
    });
  });
});