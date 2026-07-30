import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFindFirst,
  mockTxUpdate,
  mockWithSystemContext,
  mockWithOrgContext,
  mockAudit,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockWithSystemContext: vi.fn(async (..._args: unknown[]) => undefined),
  mockWithOrgContext: vi.fn(async (..._args: unknown[]) => undefined),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: {},
  withSystemContext: mockWithSystemContext,
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
  sql: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getPublicDashboard } from '@/lib/sharing/get-public-dashboard';

const validLink = {
  id: 'link-id',
  token: 'valid-token',
  orgId: 'org-123',
  dashboardId: 'dash-456',
  expiresAt: new Date('2030-01-01'),
  revokedAt: null,
  viewCount: 5,
  lastViewedAt: new Date('2026-07-01'),
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
  (mockWithSystemContext as unknown as { mockImplementation: (impl: (fn: unknown) => Promise<unknown>) => void }).mockImplementation((fn: unknown) => {
    const tx = { query: { publicLinks: { findFirst: mockFindFirst } } };
    return (fn as (t: typeof tx) => Promise<unknown>)(tx);
  });
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
    mockFindFirst.mockReset();
    mockTxUpdate.mockReset();
    installMocks();
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockTxUpdate.mockReturnValue({ set });
  });

  it('returns not_found when token does not exist', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const result = await getPublicDashboard('missing-token');
    expect(result.status).toBe('not_found');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns expired when expiresAt is in the past', async () => {
    mockFindFirst.mockResolvedValueOnce({ ...validLink, expiresAt: new Date('2020-01-01') });
    const result = await getPublicDashboard('expired-token');
    expect(result.status).toBe('expired');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns revoked when revokedAt is set', async () => {
    mockFindFirst.mockResolvedValueOnce({ ...validLink, revokedAt: new Date('2026-07-15') });
    const result = await getPublicDashboard('revoked-token');
    expect(result.status).toBe('revoked');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns ok with dashboard when token is valid', async () => {
    mockFindFirst
      .mockResolvedValueOnce(validLink)
      .mockResolvedValueOnce(validDashboard);
    const result = await getPublicDashboard('valid-token');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.dashboard.id).toBe('dash-456');
      expect(result.dashboard.orgId).toBe('org-123');
    }
  });

  it('looks up dashboard inside withOrgContext for RLS isolation', async () => {
    mockFindFirst
      .mockResolvedValueOnce(validLink)
      .mockResolvedValueOnce(validDashboard);
    await getPublicDashboard('valid-token');

    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-123',
      null,
      'editor',
      expect.any(Function)
    );
  });

  it('increments view count and writes audit on successful view', async () => {
    mockFindFirst
      .mockResolvedValueOnce(validLink)
      .mockResolvedValueOnce(validDashboard);
    await getPublicDashboard('valid-token');

    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      'org-123',
      null,
      'public_link.viewed',
      'public_link:link-id'
    );
  });

  it('does not crash if view count update fails (fire-and-forget)', async () => {
    mockFindFirst
      .mockResolvedValueOnce(validLink)
      .mockResolvedValueOnce(validDashboard);
    mockTxUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValueOnce(new Error('db fail')),
      }),
    });
    const result = await getPublicDashboard('valid-token');
    expect(result.status).toBe('ok');
  });
});