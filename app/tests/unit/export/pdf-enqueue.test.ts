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

const EXPECTED = { orgId: 'org-1', dashboardId: 'dash-1' };

const OWNED_JOB_DATA = {
  url: 'https://app.example.com/dashboard/dash-1/print?token=print-token-aaaaaaaaaaaaaaaaaaaa',
  options: { pageSize: 'Letter' as const },
  branding: { logoUrl: 'https://cdn/logo.png' },
  orgId: 'org-1',
  userId: 'user-1',
  dashboardId: 'dash-1',
};

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
        // CRITICAL-1: ownership travels with the job so getPdfJobStatus
        // can reject job ids belonging to another tenant.
        orgId: 'org-1',
        userId: 'user-1',
        dashboardId: 'dash-1',
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

    it('persists orgId, userId and dashboardId in the job payload', async () => {
      await enqueuePdfExport({
        dashboardId: 'dash-1',
        orgId: 'org-1',
        userId: 'user-1',
      });

      const firstCall = mockQueueAdd.mock.calls[0];
      const payload = firstCall![1];
      // Exact shape: the three worker-read fields (url/options/branding) are
      // unchanged and the ownership fields are purely additive.
      expect(payload).toEqual({
        url: expect.any(String),
        options: { pageSize: 'Letter' },
        branding: { logoUrl: 'https://cdn/logo.png' },
        orgId: 'org-1',
        userId: 'user-1',
        dashboardId: 'dash-1',
      });
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
      const result = await getPdfJobStatus('missing', EXPECTED);
      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns active state when job is still queued', async () => {
      mockQueueGetJob.mockResolvedValueOnce({
        data: OWNED_JOB_DATA,
        isCompleted: async () => false,
        isFailed: async () => false,
        getState: async () => 'active',
        returnvalue: undefined,
      });
      const result = await getPdfJobStatus('job-1', EXPECTED);
      expect(result).toEqual({ status: 'active' });
    });

    it('returns completed with buffer when job finished', async () => {
      const fakeBuffer = Buffer.from('PDF-BYTES');
      mockQueueGetJob.mockResolvedValueOnce({
        data: OWNED_JOB_DATA,
        isCompleted: async () => true,
        isFailed: async () => false,
        getState: async () => 'completed',
        returnvalue: { buffer: fakeBuffer },
      });
      const result = await getPdfJobStatus('job-1', EXPECTED);
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.buffer).toBe(fakeBuffer);
      }
    });

    it('returns failed with reason when job failed', async () => {
      mockQueueGetJob.mockResolvedValueOnce({
        data: OWNED_JOB_DATA,
        isCompleted: async () => false,
        isFailed: async () => true,
        getState: async () => 'failed',
        failedReason: 'puppeteer timeout',
        returnvalue: undefined,
      });
      const result = await getPdfJobStatus('job-1', EXPECTED);
      expect(result).toEqual({ status: 'failed', reason: 'puppeteer timeout' });
    });

    it('returns not_found when the job belongs to another org', async () => {
      const isCompleted = vi.fn(async () => true);
      mockQueueGetJob.mockResolvedValueOnce({
        data: { ...OWNED_JOB_DATA, orgId: 'org-attacker' },
        isCompleted,
        isFailed: async () => false,
        getState: async () => 'completed',
        returnvalue: { buffer: Buffer.from('VICTIM-PDF') },
      });

      const result = await getPdfJobStatus('job-1', EXPECTED);

      expect(result).toEqual({ status: 'not_found' });
      // Rejected before any payload is read: the buffer is never surfaced.
      expect(isCompleted).not.toHaveBeenCalled();
    });

    it('returns not_found when the job belongs to a different dashboard', async () => {
      mockQueueGetJob.mockResolvedValueOnce({
        data: { ...OWNED_JOB_DATA, dashboardId: 'dash-other' },
        isCompleted: async () => true,
        isFailed: async () => false,
        getState: async () => 'completed',
        returnvalue: { buffer: Buffer.from('OTHER-DASHBOARD-PDF') },
      });

      const result = await getPdfJobStatus('job-1', EXPECTED);

      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns not_found for a legacy job payload enqueued before the fix', async () => {
      const { orgId, ...legacyData } = OWNED_JOB_DATA;
      void orgId;
      mockQueueGetJob.mockResolvedValueOnce({
        data: legacyData,
        isCompleted: async () => true,
        isFailed: async () => false,
        getState: async () => 'completed',
        returnvalue: { buffer: Buffer.from('LEGACY-PDF') },
      });

      const result = await getPdfJobStatus('job-1', EXPECTED);

      expect(result).toEqual({ status: 'not_found' });
    });

    it('allows a different user of the same org to read the job', async () => {
      const fakeBuffer = Buffer.from('PDF-BYTES');
      mockQueueGetJob.mockResolvedValueOnce({
        data: { ...OWNED_JOB_DATA, userId: 'user-colleague' },
        isCompleted: async () => true,
        isFailed: async () => false,
        getState: async () => 'completed',
        returnvalue: { buffer: fakeBuffer },
      });

      const result = await getPdfJobStatus('job-1', EXPECTED);

      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.buffer).toBe(fakeBuffer);
      }
    });
  });
});