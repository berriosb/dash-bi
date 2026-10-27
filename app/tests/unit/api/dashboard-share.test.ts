import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockDbInsert,
  mockDbSelect,
  mockDbExecute,
  mockFindFirst,
  mockTxUpdate,
  mockWithOrgContext,
  mockRequireAuth,
  mockGeneratePublicToken,
  mockAudit,
} = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbExecute: vi.fn(),
  mockFindFirst: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (..._args: unknown[]) => undefined
  ),
  mockRequireAuth: vi.fn(),
  mockGeneratePublicToken: vi.fn().mockReturnValue('test-token-aaaaaaaaaaaaaaaaaaaaaaaa'),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: { insert: mockDbInsert, select: mockDbSelect, execute: mockDbExecute },
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
import { getPublicDashboard } from '@/lib/sharing/get-public-dashboard';

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
    mockDbSelect.mockReset();
    mockAudit.mockReset();
    mockGeneratePublicToken.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
    mockGeneratePublicToken.mockReturnValue('test-token-aaaaaaaaaaaaaaaaaaaaaaaa');
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 'dash-123' }],
        }),
      }),
    });
    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      const fn = args[3] as (t: unknown) => Promise<unknown>;
      return fn({ insert: mockDbInsert, select: mockDbSelect });
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

    // One call proves dashboard ownership, one inserts the link.
    expect(mockWithOrgContext).toHaveBeenCalledTimes(2);
    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-test',
      'user-test',
      'admin',
      expect.any(Function)
    );
  });

  it('refuses to mint a public link for a dashboard outside the caller org', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    });

    const req = makeReq({});
    const res = await POST(req, { params: Promise.resolve({ id: 'dash-foreign' }) });

    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
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

/**
 * Security P0 (task 6): the public share link is anonymous. The stored
 * widget carries the query that produced its data — `source.query.sql` and
 * `source.dataSourceId` — so shipping the widget verbatim hands an
 * anonymous visitor the tenant's table names, column names, join logic and
 * business filters. The dashboard renders from the pre-hydrated `data`, so
 * the SQL is never needed to draw it.
 */
describe('getPublicDashboard — public payload (security P0 task 6)', () => {
  const widgetWithQueryInternals = {
    id: 'w-1',
    type: 'kpi',
    position: { col: 1, row: 1, colSpan: 6, rowSpan: 1 },
    config: { title: 'Ingresos netos' },
    data: { value: 128400, delta: 8.4 },
    source: {
      kind: 'query',
      dataSourceId: 'ds-internal-42',
      query: {
        kind: 'sql',
        sql: "SELECT sum(total) FROM sales JOIN customers ON sales.customer_id = customers.id WHERE region = 'EMEA'",
      },
    },
  };

  const linkRow = {
    id: 'link-1',
    org_id: 'org-1',
    dashboard_id: 'dash-1',
    token: 'public-token',
    expires_at: new Date('2030-01-01'),
    revoked_at: null,
  };

  const dashboardRow = {
    id: 'dash-1',
    orgId: 'org-1',
    title: 'Ventas',
    description: null,
    theme: 'moderno-saas',
    widgets: [widgetWithQueryInternals],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue([linkRow]);
    mockFindFirst.mockResolvedValue(dashboardRow);
    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      const fn = args[3] as (t: unknown) => Promise<unknown>;
      return fn({
        query: { dashboards: { findFirst: mockFindFirst } },
        update: mockTxUpdate,
      });
    });
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockTxUpdate.mockReturnValue({ set });
  });

  it('does not ship the widget query (SQL + data source id) to an anonymous visitor', async () => {
    const result = await getPublicDashboard('public-token');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SELECT sum(total)');
    expect(serialized).not.toContain('ds-internal-42');
    expect(serialized).not.toContain('dataSourceId');
    expect(serialized).not.toContain('source');

    const widgets = result.dashboard.widgets as Record<string, unknown>[];
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).not.toHaveProperty('source');
    expect(widgets[0]).not.toHaveProperty('dataSourceId');
  });

  it('keeps the widget fields the renderer needs', async () => {
    const result = await getPublicDashboard('public-token');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    // A fix that dropped the whole widget would satisfy "no source" and
    // render an empty dashboard. The renderer needs these fields.
    const widgets = result.dashboard.widgets as Record<string, unknown>[];
    expect(widgets[0]).toMatchObject({
      id: 'w-1',
      type: 'kpi',
      position: { col: 1, row: 1, colSpan: 6, rowSpan: 1 },
      config: { title: 'Ingresos netos' },
      data: { value: 128400, delta: 8.4 },
    });
  });
});
