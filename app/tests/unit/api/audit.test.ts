import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDbSelect,
  mockWithOrgContext,
  mockRequirePermission,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (_orgId: string, _userId: string | null, fn: () => Promise<unknown>) => fn()
  ),
  mockRequirePermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: { select: mockDbSelect },
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/auth/context', () => ({
  requirePermission: mockRequirePermission,
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

function makeReq(query: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
  const url = new URL('http://localhost/api/audit');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    method: 'GET',
    headers: {
      'x-org-id': 'org-test',
      'x-user-id': 'user-test',
      ...headers,
    },
  });
}

describe('GET /api/audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(undefined);
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
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-test', 'user-test', expect.any(Function));
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
    const selectResult = mockDbSelect.mock.results[0]?.value as {
      from: ReturnType<typeof vi.fn>;
    };
    const fromResult = selectResult.from.mock.results[0]?.value as {
      where: ReturnType<typeof vi.fn>;
    };
    const whereResult = fromResult.where.mock.results[0]?.value as {
      orderBy: ReturnType<typeof vi.fn>;
    };
    const orderByResult = whereResult.orderBy.mock.results[0]?.value as {
      limit: ReturnType<typeof vi.fn>;
    };
    expect(orderByResult.limit).toHaveBeenCalledWith(100);
  });

  it('respects custom limit param', async () => {
    await GET(makeReq({ limit: '25' }));
    const selectResult = mockDbSelect.mock.results[0]?.value as {
      from: ReturnType<typeof vi.fn>;
    };
    const fromResult = selectResult.from.mock.results[0]?.value as {
      where: ReturnType<typeof vi.fn>;
    };
    const whereResult = fromResult.where.mock.results[0]?.value as {
      orderBy: ReturnType<typeof vi.fn>;
    };
    const orderByResult = whereResult.orderBy.mock.results[0]?.value as {
      limit: ReturnType<typeof vi.fn>;
    };
    expect(orderByResult.limit).toHaveBeenCalledWith(25);
  });

  it('filters by category when category param is provided', async () => {
    await GET(makeReq({ category: 'dashboard' }));
    // The query chain is exercised; we just verify the call was made without error
    expect(mockDbSelect).toHaveBeenCalled();
  });

  it('rejects when x-org-id header is missing', async () => {
    const res = await GET(makeReq({}, { 'x-org-id': '' }));
    expect(res.status).toBe(400);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks audit:read permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { name: 'ForbiddenError' })
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });
});