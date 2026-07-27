import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockValidatePrintToken,
  mockFindFirst,
  mockWithOrgContext,
  mockAudit,
} = vi.hoisted(() => ({
  mockValidatePrintToken: vi.fn(),
  mockFindFirst: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (_orgId: string, _userId: string | null, fn: () => Promise<unknown>) => fn()
  ),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/export/print-token', () => ({
  validatePrintToken: mockValidatePrintToken,
}));

vi.mock('@/db/client', () => ({
  db: { query: { dashboards: { findFirst: mockFindFirst } } },
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/db/schema', () => ({
  dashboards: { id: 'id', orgId: 'orgId', widgets: 'widgets', theme: 'theme' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
}));

vi.mock('@/lib/audit/log', () => ({
  audit: mockAudit,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getPrintDashboard } from '@/lib/export/get-print-dashboard';

const validToken = 'valid-token-xyz';
const payload = { dashboardId: 'dash-456', orgId: 'org-123' };
const validDashboard = {
  id: 'dash-456',
  orgId: 'org-123',
  title: 'Sales Q3',
  description: null,
  theme: 'moderno-saas',
  widgets: [],
};

describe('getPrintDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit.mockResolvedValue(undefined);
    mockWithOrgContext.mockImplementation(async (_orgId, _userId, fn) => fn());
  });

  it('returns unauthorized when token is invalid', async () => {
    mockValidatePrintToken.mockResolvedValueOnce(null);
    const result = await getPrintDashboard('bad-token');
    expect(result.status).toBe('unauthorized');
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('returns ok with dashboard when token is valid', async () => {
    mockValidatePrintToken.mockResolvedValueOnce(payload);
    mockFindFirst.mockResolvedValueOnce(validDashboard);

    const result = await getPrintDashboard(validToken);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.dashboard.id).toBe('dash-456');
      expect(result.dashboard.orgId).toBe('org-123');
    }
  });

  it('fetches dashboard inside withOrgContext for RLS isolation', async () => {
    mockValidatePrintToken.mockResolvedValueOnce(payload);
    mockFindFirst.mockResolvedValueOnce(validDashboard);

    await getPrintDashboard(validToken);

    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-123',
      null,
      expect.any(Function)
    );
  });

  it('returns not_found when dashboard does not exist', async () => {
    mockValidatePrintToken.mockResolvedValueOnce(payload);
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await getPrintDashboard(validToken);
    expect(result.status).toBe('not_found');
  });
});