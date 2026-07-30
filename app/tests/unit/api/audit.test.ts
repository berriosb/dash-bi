import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockDbSelect,
  mockWithOrgContext,
  mockRequireAuth,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (..._args: unknown[]) => undefined
  ),
  mockRequireAuth: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  db: { select: mockDbSelect },
  withOrgContext: mockWithOrgContext,
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
}));


vi.mock('@/lib/audit/events', () => ({
  AUDIT_EVENT_CATEGORIES: {
    auth: ['auth.login'],
    dashboard: ['dashboard.generated', 'dashboard.shared'],
  },
}));


vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
  gte: vi.fn((a: unknown, b: unknown) => ({ op: 'gte', a, b })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ op: 'inArray', a, b })),
}));


vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));


import { GET } from '@/app/api/audit/route';

function makeReq(query: Record<string, string> = {}): Request {
  const url = new URL('http://localhost/api/audit');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: 'GET' });
}

describe('GET /api/audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReset();
    mockWithOrgContext.mockReset();
    mockDbSelect.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      const fn = args[3] as (t: unknown) => Promise<unknown>;
      return fn({ select: mockDbSelect });
    });
    const limit = vi.fn().mockResolvedValue([
      { id: 'evt-1', action: 'dashboard.generated', userId: 'u-1', resource: 'dashboard:d-1', metadata: null, ip: '1.2.3.4', createdAt: new Date('2026-07-01') },
      { id: 'evt-2', action: 'auth.login', userId: 'u-2', resource: null, metadata: null, ip: null, createdAt: new Date('2026-07-02') },
    ]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    mockDbSelect.mockReturnValue({ from });
  });

  it('returns audit entries scoped to current org via withOrgContext', async () => {
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-test', 'user-test', 'admin', expect.any(Function));
  });

  it('returns entries with id, action, userId, resource, createdAt fields', async () => {
    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({
      id: 'evt-1',
      action: 'dashboard.generated',
      userId: 'u-1',
      resource: 'dashboard:d-1',
    });
    expect(body.entries[0].createdAt).toBeDefined();
  });

  it('limits results to 100 by default', async () => {
    await GET(makeReq());
    const selectResult = mockDbSelect.mock.results[0]?.value as { from: ReturnType<typeof vi.fn> };
    const fromResult = selectResult.from.mock.results[0]?.value as { where: ReturnType<typeof vi.fn> };
    const whereResult = fromResult.where.mock.results[0]?.value as { orderBy: ReturnType<typeof vi.fn> };
    const orderByResult = whereResult.orderBy.mock.results[0]?.value as { limit: ReturnType<typeof vi.fn> };
    expect(orderByResult.limit).toHaveBeenCalledWith(100);
  });

  it('respects custom limit param', async () => {
    await GET(makeReq({ limit: '25' }));
    const selectResult = mockDbSelect.mock.results[0]?.value as { from: ReturnType<typeof vi.fn> };
    const fromResult = selectResult.from.mock.results[0]?.value as { where: ReturnType<typeof vi.fn> };
    const whereResult = fromResult.where.mock.results[0]?.value as { orderBy: ReturnType<typeof vi.fn> };
    const orderByResult = whereResult.orderBy.mock.results[0]?.value as { limit: ReturnType<typeof vi.fn> };
    expect(orderByResult.limit).toHaveBeenCalledWith(25);
  });

  it('filters by category when category param is provided', async () => {
    await GET(makeReq({ category: 'dashboard' }));
    expect(mockDbSelect).toHaveBeenCalled();
  });

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks audit:read permission', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new ForbiddenError()
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });
});
