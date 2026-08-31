import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockDbInsert,
  mockWithOrgContext,
  mockRequireAuth,
  mockGeneratePublicToken,
  mockAudit,
} = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (..._args: unknown[]) => undefined
  ),
  mockRequireAuth: vi.fn(),
  mockGeneratePublicToken: vi.fn().mockReturnValue('test-token-aaaaaaaaaaaaaaaaaaaaaaaa'),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: { insert: mockDbInsert },
  withOrgContext: mockWithOrgContext,
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
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


import { POST, GET } from '@/app/api/dashboards/[id]/share/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/dashboards/dash-123/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetReq(): Request {
  return new Request('http://localhost/api/dashboards/dash-123/share', {
    method: 'GET',
  });
}

describe('POST /api/dashboards/[id]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReset();
    mockWithOrgContext.mockReset();
    mockDbInsert.mockReset();
    mockAudit.mockReset();
    mockGeneratePublicToken.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
    mockGeneratePublicToken.mockReturnValue('test-token-aaaaaaaaaaaaaaaaaaaaaaaa');
    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      const fn = args[3] as (t: unknown) => Promise<unknown>;
      return fn({ insert: mockDbInsert });
    });
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'link-id-1',
        token: 'test-token-aaaaaaaaaaaaaaaaaaaaaaaa',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    ]);
    const values = vi.fn().mockReturnValue({ returning });
    mockDbInsert.mockReturnValue({ values });
    mockAudit.mockResolvedValue(undefined);
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
    expect(mockRequireAuth).toHaveBeenCalledWith(req, 'dashboard.sharePublic');
  });

  it('respects custom expiresInDays', async () => {
    const req = makeReq({ expiresInDays: 7 });
    await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });

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
      'admin',
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

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const req = makeReq({});
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });
    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks sharePublic permission', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new ForbiddenError()
    );
    const req = makeReq({});
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-123' }) });
    expect(res.status).toBe(403);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/dashboards/[id]/share', () => {
  const mockFindMany = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReset();
    mockWithOrgContext.mockReset();
    mockFindMany.mockReset();

    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });

    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      const fn = args[3] as (t: unknown) => Promise<unknown>;
      return fn({
        query: {
          publicLinks: {
            findMany: mockFindMany,
          },
        },
      });
    });

    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  it('lists active public links for the dashboard', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'link-1',
        token: 'token-123456789012345678901234',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        viewCount: 5,
        lastViewedAt: new Date('2026-08-01T00:00:00Z'),
        createdAt: new Date('2026-07-01T00:00:00Z'),
      },
    ]);

    const req = makeGetReq();
    const res = await GET(req, { params: Promise.resolve({ id: 'dash-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.links).toHaveLength(1);
    expect(json.links[0].url).toBe('http://localhost:3000/share/token-123456789012345678901234');
    expect(json.links[0].viewCount).toBe(5);
    expect(mockRequireAuth).toHaveBeenCalledWith(req, 'dashboard.view');
  });

  it('returns 401 when session is invalid on GET', async () => {
    mockRequireAuth.mockRejectedValueOnce(new UnauthorizedError());
    const req = makeGetReq();
    const res = await GET(req, { params: Promise.resolve({ id: 'dash-123' }) });
    expect(res.status).toBe(401);
  });
});
