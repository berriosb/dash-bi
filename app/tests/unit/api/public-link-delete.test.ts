import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockDbUpdate,
  mockWithOrgContext,
  mockRequireAuth,
  mockAudit,
} = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (..._args: unknown[]) => undefined
  ),
  mockRequireAuth: vi.fn(),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/client', () => ({
  db: { update: mockDbUpdate },
  withOrgContext: mockWithOrgContext,
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


import { DELETE } from '@/app/api/public-links/[id]/route';

function makeReq(): Request {
  return new Request('http://localhost/api/public-links/link-123', {
    method: 'DELETE',
  });
}

describe('DELETE /api/public-links/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReset();
    mockWithOrgContext.mockReset();
    mockDbUpdate.mockReset();
    mockAudit.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-test',
      email: 'a@b.com',
      orgId: 'org-test',
      role: 'admin',
    });
    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      const fn = args[3] as (t: unknown) => Promise<unknown>;
      return fn({ update: mockDbUpdate });
    });
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValue({ set });
    mockAudit.mockResolvedValue(undefined);
  });

  it('revokes the link by setting revokedAt inside withOrgContext', async () => {
    const req = makeReq();
    const res = await DELETE(req, { params: Promise.resolve({ id: 'link-123' }) });

    expect(res.status).toBe(200);
    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockWithOrgContext).toHaveBeenCalledWith('org-test', 'user-test', 'admin', expect.any(Function));
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
      'public_link:link-123',
      expect.objectContaining({ req: expect.any(Object) })
    );
  });

  it('returns 401 when session is invalid', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const req = makeReq();
    const res = await DELETE(req, { params: Promise.resolve({ id: 'link-123' }) });
    expect(res.status).toBe(401);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks sharePublic permission', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new ForbiddenError()
    );
    const req = makeReq();
    const res = await DELETE(req, { params: Promise.resolve({ id: 'link-123' }) });
    expect(res.status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
