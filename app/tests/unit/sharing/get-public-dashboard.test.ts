import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDbExecute,
  mockFindFirst,
  mockSql,
  mockTxUpdate,
  mockWithOrgContext,
  mockAudit,
} = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockFindFirst: vi.fn(),
  mockSql: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  db: { execute: mockDbExecute },
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/db/schema', () => ({
  publicLinks: { id: 'id', token: 'token', expiresAt: 'expiresAt', revokedAt: 'revokedAt', viewCount: 'viewCount', lastViewedAt: 'lastViewedAt', orgId: 'orgId', dashboardId: 'dashboardId' },
  dashboards: { id: 'id', orgId: 'orgId', widgets: 'widgets', theme: 'theme' },
}));

vi.mock('@/lib/audit/log', () => ({
  audit: mockAudit,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  sql: mockSql,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getPublicDashboard } from '@/lib/sharing/get-public-dashboard';
import { publicLinks } from '@/db/schema';

/**
 * `dashbi_resolve_public_link(...)` is a raw SQL function, so the row comes
 * back with column names, not Drizzle keys. `db.execute` under the
 * postgres-js driver resolves to the rows array itself (no `{ rows }`
 * wrapper), which is the shape the module indexes into.
 */
const validLinkRow = {
  id: 'link-id',
  org_id: 'org-123',
  dashboard_id: 'dash-456',
  token: 'valid-token',
  expires_at: new Date('2030-01-01'),
  revoked_at: null,
  view_count: 5,
  last_viewed_at: new Date('2026-07-01'),
};

const validDashboard = {
  id: 'dash-456',
  orgId: 'org-123',
  title: 'Sales Q3',
  description: null,
  theme: 'moderno-saas',
  widgets: [],
};

function installMocks(): void {
  (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
    let fn: unknown;
    if (args.length === 4) fn = args[3];
    else if (args.length === 3) fn = args[2];
    const tx = {
      query: { dashboards: { findFirst: mockFindFirst } },
      update: mockTxUpdate,
    };
    return (fn as (t: typeof tx) => Promise<unknown>)(tx);
  });
}

describe('getPublicDashboard', () => {
  beforeEach(() => {
    // clearAllMocks preserves constructor `mockReturnValue` set in vi.hoisted,
    // so the mock fns keep their shape. We then rewire the implementations
    // and reset the per-test `mockResolvedValueOnce` queue manually.
    vi.clearAllMocks();
    mockAudit.mockResolvedValue(undefined);
    mockDbExecute.mockReset();
    mockFindFirst.mockReset();
    mockTxUpdate.mockReset();
    installMocks();
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockTxUpdate.mockReturnValue({ set });
  });

  it('returns not_found when the resolver finds no link', async () => {
    mockDbExecute.mockResolvedValueOnce([]);
    const result = await getPublicDashboard('missing-token');
    expect(result.status).toBe('not_found');
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('resolves the token through dashbi_resolve_public_link, not a Drizzle query', async () => {
    mockDbExecute.mockResolvedValueOnce([]);
    await getPublicDashboard('some-token');
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    // The token goes through the pinned SECURITY DEFINER function — the
    // resolver, not a table scan under a bypassed RLS context.
    const [strings, token] = mockSql.mock.calls[0] as [TemplateStringsArray, string];
    expect(strings.join('?')).toContain('dashbi_resolve_public_link');
    expect(token).toBe('some-token');
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('returns expired when expires_at is in the past', async () => {
    mockDbExecute.mockResolvedValueOnce([
      { ...validLinkRow, expires_at: new Date('2020-01-01') },
    ]);
    const result = await getPublicDashboard('expired-token');
    expect(result.status).toBe('expired');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns revoked when revoked_at is set', async () => {
    mockDbExecute.mockResolvedValueOnce([
      { ...validLinkRow, revoked_at: new Date('2026-07-15') },
    ]);
    const result = await getPublicDashboard('revoked-token');
    expect(result.status).toBe('revoked');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns ok with dashboard when token is valid', async () => {
    mockDbExecute.mockResolvedValueOnce([validLinkRow]);
    mockFindFirst.mockResolvedValueOnce(validDashboard);
    const result = await getPublicDashboard('valid-token');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.dashboard.id).toBe('dash-456');
      expect(result.dashboard.orgId).toBe('org-123');
    }
  });

  it('looks up dashboard inside withOrgContext for RLS isolation', async () => {
    mockDbExecute.mockResolvedValueOnce([validLinkRow]);
    mockFindFirst.mockResolvedValueOnce(validDashboard);
    await getPublicDashboard('valid-token');

    // org_id / dashboard_id come from the resolver row, in raw column names.
    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-123',
      null,
      'editor',
      expect.any(Function)
    );
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { op: 'eq', a: 'id', b: 'dash-456' },
    });
  });

  it('increments view count and writes audit on successful view', async () => {
    mockDbExecute.mockResolvedValueOnce([validLinkRow]);
    mockFindFirst.mockResolvedValueOnce(validDashboard);
    await getPublicDashboard('valid-token');

    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).toHaveBeenCalledWith(publicLinks);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      'org-123',
      null,
      'public_link.viewed',
      'public_link:link-id'
    );
  });

  it('does not crash if view count update fails (fire-and-forget)', async () => {
    mockDbExecute.mockResolvedValueOnce([validLinkRow]);
    mockFindFirst.mockResolvedValueOnce(validDashboard);
    mockTxUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValueOnce(new Error('db fail')),
      }),
    });
    const result = await getPublicDashboard('valid-token');
    expect(result.status).toBe('ok');
  });
});
