import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type * as PdfEnqueueModule from '@/lib/export/pdf-enqueue';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockEnqueuePdfExport,
  mockGetPdfJobStatus,
  mockRequireAuth,
  mockAudit,
  mockQueueGetJob,
} = vi.hoisted(() => ({
  mockEnqueuePdfExport: vi.fn(),
  mockGetPdfJobStatus: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockAudit: vi.fn().mockResolvedValue(undefined),
  mockQueueGetJob: vi.fn(),
}));

// The cross-tenant block below drives the REAL getPdfJobStatus through the
// route, with only the BullMQ transport faked. The module-level mock for
// @/lib/export/pdf-enqueue is overridden per-test with
// mockGetPdfJobStatus.mockImplementationOnce(realGetPdfJobStatus).
vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({ getJob: mockQueueGetJob })),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}));

vi.mock('@/lib/export/print-token', () => ({
  generatePrintToken: vi.fn().mockResolvedValue('print-token'),
}));

vi.mock('@/lib/export/branding', () => ({
  getOrgBranding: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/export/pdf-enqueue', () => ({
  enqueuePdfExport: mockEnqueuePdfExport,
  getPdfJobStatus: mockGetPdfJobStatus,
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
}));


vi.mock('@/lib/audit/log', () => ({
  audit: mockAudit,
}));


vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type PdfStatusFn = (
  jobId: string,
  expected: { orgId: string; dashboardId: string }
) => Promise<unknown>;

type JobData = {
  url: string;
  options: { pageSize: 'A4' | 'Letter' };
  branding: { logoUrl?: string };
  orgId?: string;
  userId?: string;
  dashboardId?: string;
};

function makeGetReq(jobId: string, dashboardId = 'dash-123'): Request {
  return new Request(
    `http://localhost/api/dashboards/${dashboardId}/export/pdf?jobId=${jobId}`,
    { method: 'GET' }
  );
}

/** A completed BullMQ job as it would be read back from Redis. */
function completedJob(data: JobData, bytes: string) {
  return {
    data,
    isCompleted: async () => true,
    isFailed: async () => false,
    getState: async () => 'completed',
    returnvalue: { buffer: Buffer.from(bytes) },
  };
}


import { POST, GET } from '@/app/api/dashboards/[id]/export/pdf/route';

function makeReq(method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/dashboards/dash-123/export/pdf`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/dashboards/[id]/export/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
    mockEnqueuePdfExport.mockReset();
    mockEnqueuePdfExport.mockResolvedValue('job-abc-123');
  });

  it('returns 202 with jobId and status queued', async () => {
    const res = await POST(makeReq('POST', {}), { params: Promise.resolve({ id: 'dash-123' }) });
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: 'job-abc-123', status: 'queued' });
  });

  it('enqueues with default Letter pageSize', async () => {
    await POST(makeReq('POST', {}), { params: Promise.resolve({ id: 'dash-123' }) });

    expect(mockEnqueuePdfExport).toHaveBeenCalledWith({
      dashboardId: 'dash-123',
      orgId: 'org-test',
      userId: 'user-test',
      pageSize: 'Letter',
    });
  });

  it('respects custom pageSize in body', async () => {
    await POST(makeReq('POST', { pageSize: 'A4' }), { params: Promise.resolve({ id: 'dash-123' }) });

    expect(mockEnqueuePdfExport).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 'A4' })
    );
  });

  it('writes audit log entry export.pdf_requested', async () => {
    await POST(makeReq('POST', {}), { params: Promise.resolve({ id: 'dash-123' }) });

    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      'org-test',
      'user-test',
      'export.pdf_requested',
      'dashboard:dash-123',
      expect.objectContaining({ metadata: expect.objectContaining({ jobId: 'job-abc-123' }) })
    );
  });

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await POST(makeReq('POST', {}), { params: Promise.resolve({ id: 'dash-123' }) });
    expect(res.status).toBe(401);
    expect(mockEnqueuePdfExport).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks export.pdf permission', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new ForbiddenError()
    );
    const res = await POST(makeReq('POST', {}), { params: Promise.resolve({ id: 'dash-123' }) });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/dashboards/[id]/export/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
  });

  it('returns job status as JSON when not completed', async () => {
    mockGetPdfJobStatus.mockResolvedValueOnce({ status: 'active' });
    const req = makeReq('GET');
    const url = new URL(req.url);
    url.searchParams.set('jobId', 'job-1');
    const res = await GET(
      new Request(url.toString(), { method: 'GET', headers: req.headers }),
      { params: Promise.resolve({ id: 'dash-123' }) }
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'active' });
  });

  it('returns PDF buffer when job completed', async () => {
    const buffer = Buffer.from('PDF-CONTENT');
    mockGetPdfJobStatus.mockResolvedValueOnce({ status: 'completed', buffer });

    const req = makeReq('GET');
    const url = new URL(req.url);
    url.searchParams.set('jobId', 'job-1');
    const res = await GET(
      new Request(url.toString(), { method: 'GET', headers: req.headers }),
      { params: Promise.resolve({ id: 'dash-123' }) }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="dashboard-dash-123.pdf"');
    const body = await res.arrayBuffer();
    expect(Buffer.from(body).toString()).toBe('PDF-CONTENT');
  });

  it('returns 400 when jobId is missing', async () => {
    const res = await GET(makeReq('GET'), { params: Promise.resolve({ id: 'dash-123' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when job is not found', async () => {
    mockGetPdfJobStatus.mockResolvedValueOnce({ status: 'not_found' });
    const req = makeReq('GET');
    const url = new URL(req.url);
    url.searchParams.set('jobId', 'missing');
    const res = await GET(
      new Request(url.toString(), { method: 'GET', headers: req.headers }),
      { params: Promise.resolve({ id: 'dash-123' }) }
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/dashboards/[id]/export/pdf — cross-tenant isolation', () => {
  let realGetPdfJobStatus: PdfStatusFn;

  const AUTH_CTX = { userId: 'user-test', email: 'a@b.com', orgId: 'org-test', role: 'admin' };

  const VICTIM_JOB_DATA: JobData = {
    url: 'https://app.example.com/dashboard/dash-victim/print?token=t',
    options: { pageSize: 'Letter' },
    branding: { logoUrl: 'https://cdn/victim.png' },
    orgId: 'org-victim',
    userId: 'user-victim',
    dashboardId: 'dash-victim',
  };

  beforeAll(async () => {
    const actual = await vi.importActual<typeof PdfEnqueueModule>(
      '@/lib/export/pdf-enqueue'
    );
    realGetPdfJobStatus = actual.getPdfJobStatus as unknown as PdfStatusFn;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue(AUTH_CTX);
    delegateToRealStatus(1);
  });

  /** Route the next `times` getPdfJobStatus calls to the real implementation. */
  function delegateToRealStatus(times: number) {
    for (let i = 0; i < times; i += 1) {
      mockGetPdfJobStatus.mockImplementationOnce(realGetPdfJobStatus);
    }
  }

  it('does not return the buffer when the job belongs to another org', async () => {
    mockQueueGetJob.mockResolvedValueOnce(completedJob(VICTIM_JOB_DATA, 'VICTIM-PDF-BYTES'));

    const res = await GET(makeGetReq('7'), { params: Promise.resolve({ id: 'dash-123' }) });
    const body = await res.text();

    expect(res.status).toBe(404);
    expect(JSON.parse(body)).toEqual({ status: 'not_found' });
    expect(res.headers.get('Content-Type')).not.toBe('application/pdf');
    expect(body).not.toContain('VICTIM-PDF-BYTES');
  });

  it('does not return the buffer when the job belongs to a different dashboard', async () => {
    mockQueueGetJob.mockResolvedValueOnce(
      completedJob(
        {
          ...VICTIM_JOB_DATA,
          orgId: 'org-test',
          userId: 'user-colleague',
        },
        'SIBLING-DASHBOARD-BYTES'
      )
    );

    const res = await GET(makeGetReq('8'), { params: Promise.resolve({ id: 'dash-123' }) });

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('SIBLING-DASHBOARD-BYTES');
  });

  it('leaks nothing when enumerating sequential job ids of other orgs', async () => {
    // BullMQ job ids are sequential integers, so ?jobId=N walks every
    // tenant's exports. Every one of them must be indistinguishable
    // from a job that does not exist.
    mockGetPdfJobStatus.mockReset();
    delegateToRealStatus(5);
    mockQueueGetJob.mockImplementation(async (jobId: string) =>
      completedJob({ ...VICTIM_JOB_DATA, orgId: `org-${jobId}` }, `SECRET-FROM-${jobId}`)
    );

    for (const jobId of ['1', '2', '3', '4', '5']) {
      const res = await GET(makeGetReq(jobId), { params: Promise.resolve({ id: 'dash-123' }) });
      const body = await res.text();

      expect(res.status).toBe(404);
      expect(JSON.parse(body)).toEqual({ status: 'not_found' });
      expect(body).not.toContain(`SECRET-FROM-${jobId}`);
    }
    expect(mockQueueGetJob).toHaveBeenCalledTimes(5);
  });

  it('returns 404 for a legacy job payload enqueued before the ownership fields existed', async () => {
    const legacyData: JobData = {
      url: VICTIM_JOB_DATA.url,
      options: VICTIM_JOB_DATA.options,
      branding: VICTIM_JOB_DATA.branding,
    };
    mockQueueGetJob.mockResolvedValueOnce(completedJob(legacyData, 'LEGACY-PDF-BYTES'));

    const res = await GET(makeGetReq('9'), { params: Promise.resolve({ id: 'dash-123' }) });

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('LEGACY-PDF-BYTES');
  });

  it('returns the buffer for the owning org and dashboard', async () => {
    mockQueueGetJob.mockResolvedValueOnce(
      completedJob(
        {
          url: 'https://app.example.com/dashboard/dash-123/print?token=t',
          options: { pageSize: 'Letter' },
          branding: { logoUrl: 'https://cdn/logo.png' },
          orgId: 'org-test',
          userId: 'user-test',
          dashboardId: 'dash-123',
        },
        'MY-OWN-PDF-BYTES'
      )
    );

    const res = await GET(makeGetReq('10'), { params: Promise.resolve({ id: 'dash-123' }) });
    const body = Buffer.from(await res.arrayBuffer()).toString();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(body).toBe('MY-OWN-PDF-BYTES');
    // The route scopes the lookup to the caller org and the path dashboard.
    expect(mockGetPdfJobStatus).toHaveBeenCalledWith('10', {
      orgId: 'org-test',
      dashboardId: 'dash-123',
    });
  });
});
