import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDbUpdate,
  mockWithOrgContext,
  mockRequirePermission,
  mockAudit,
} = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (_orgId: string, _userId: string | null, fn: () => Promise<unknown>) => fn()
  ),
  mockRequirePermission: vi.fn().mockResolvedValue(undefined),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: { update: mockDbUpdate },
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/auth/context', () => ({
  requirePermission: mockRequirePermission,
}));

vi.mock('@/lib/audit/log', () => ({
  audit: mockAudit,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '@/app/api/public-links/[id]/route';

function makeReq(): Request {
  return new Request('http://localhost/api/public-links/link-123', {
    method: 'DELETE',
    headers: {
      'x-org-id': 'org-test',
      'x-user-id': 'user-test',
    },
  });
}

describe('DELETE /api/public-links/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue(undefined);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValue({ set });
  });

  it('revokes the link by setting revokedAt inside withOrgContext', async () => {
    const req = makeReq();
    const res = await DELETE(req, { params: Promise.resolve({ id: 'link-123' }) });

    expect(res.status).toBe(200);
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-test', 'user-test', expect.any(Function));
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    const updateResult = mockDbUpdate.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> };
    const setCall = updateResult.set.mock.calls[0]?.[0] as { revokedAt: Date };
    expect(setCall.revokedAt).toBeInstanceOf(Date);
  });

  it('writes audit log entry export.link_revoked', async () => {
    const req = makeReq();
    await DELETE(req, { params: Promise.resolve({ id: 'link-123' }) });

    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      'org-test',
      'user-test',
      'export.link_revoked',
      'public_link:link-123'
    );
  });

  it('rejects when x-org-id header is missing', async () => {
    const req = new Request('http://localhost/api/public-links/link-123', {
      method: 'DELETE',
      headers: { 'x-user-id': 'user-test' },
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'link-123' }) });

    expect(res.status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks sharePublic permission', async () => {
    mockRequirePermission.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { name: 'ForbiddenError' })
    );
    const req = makeReq();
    const res = await DELETE(req, { params: Promise.resolve({ id: 'link-123' }) });

    expect(res.status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});