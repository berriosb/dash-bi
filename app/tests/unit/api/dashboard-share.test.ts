import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDbInsert,
  mockWithOrgContext,
  mockRequirePermission,
  mockGeneratePublicToken,
  mockAudit,
} = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (_orgId: string, _userId: string | null, fn: () => Promise<unknown>) => fn()
  ),
  mockRequirePermission: vi.fn().mockResolvedValue(undefined),
  mockGeneratePublicToken: vi.fn().mockReturnValue('test-token-aaaaaaaaaaaaaaaaaaaaaaaa'),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: { insert: mockDbInsert },
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/auth/context', () => ({
  requirePermission: mockRequirePermission,
}));

vi.mock('@/lib/audit/log', () => ({
  audit: mockAudit,
}));

vi.mock('@/lib/sharing/token', () => ({
  generatePublicToken: mockGeneratePublicToken,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/dashboards/[id]/share/route';

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/dashboards/dash-123/share', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org-test',
      'x-user-id': 'user-test',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dashboards/[id]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(undefined);
    mockGeneratePublicToken.mockReturnValue('test-token-aaaaaaaaaaaaaaaaaaaaaaaa');
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'link-id-1',
        token: 'test-token-aaaaaaaaaaaaaaaaaaaaaaaa',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    ]);
    const values = vi.fn().mockReturnValue({ returning });
    mockDbInsert.mockReturnValue({ values });
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  it('creates a public link with default 30-day expiration', async () => {
    const req = makeReq({});
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.url).toBe('http://localhost:3000/share/test-token-aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(json.token).toBe('test-token-aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(json.expiresAt).toBeDefined();
    expect(mockRequirePermission).toHaveBeenCalledWith('user-test', 'org-test', 'dashboard.sharePublic');
  });

  it('respects custom expiresInDays', async () => {
    const req = makeReq({ expiresInDays: 7 });
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });

    expect(res.status).toBe(201);
    const insertResult = mockDbInsert.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> };
    const valuesFn = insertResult.values;
    const inserted = valuesFn.mock.calls[0]?.[0] as { expiresAt: Date };
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const expectedExpiry = new Date(Date.now() + sevenDays);
    expect(Math.abs(inserted.expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
  });

  it('persists link inside withOrgContext for RLS isolation', async () => {
    const req = makeReq({});
    await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });

    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-test',
      'user-test',
      expect.any(Function)
    );
  });

  it('writes an audit log entry with export.link_generated', async () => {
    const req = makeReq({});
    await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });

    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      'org-test',
      'user-test',
      'export.link_generated',
      'dashboard:dash-123',
      expect.objectContaining({ metadata: expect.objectContaining({ linkId: 'link-id-1' }) })
    );
  });

  it('rejects when x-org-id header is missing', async () => {
    const req = makeReq({}, { 'x-org-id': '' });
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });

    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('rejects when x-user-id header is missing', async () => {
    const req = makeReq({}, { 'x-user-id': '' });
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });

    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks sharePublic permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { name: 'ForbiddenError' })
    );
    const req = makeReq({});
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });

    expect(res.status).toBe(403);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});