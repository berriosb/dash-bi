import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockEnqueuePdfExport,
  mockGetPdfJobStatus,
  mockRequireAuth,
  mockAudit,
} = vi.hoisted(() => ({
  mockEnqueuePdfExport: vi.fn(),
  mockGetPdfJobStatus: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockAudit: vi.fn().mockResolvedValue(undefined),
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
