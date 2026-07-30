import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.5 — tests del helper getAuthContext. Mockeamos:
//   - better-auth para controlar la sesión resuelta.
//   - drizzle `db.query.orgMembers.findFirst` para controlar membership.
//   - request.headers/cookies para cada escenario.

const { mockGetSession, mockMembership } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockMembership: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: mockGetSession } },
}));

vi.mock('@/db/client', () => ({
  db: {
    query: {
      orgMembers: { findFirst: mockMembership },
    },
  },
}));

import { getAuthContext, requireAuth } from '@/lib/auth/request';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

function makeReq(opts: {
  orgIdHeader?: string | null;
  cookieOrgId?: string | null;
} = {}): Request {
  const headers = new Headers();
  if (opts.orgIdHeader !== null && opts.orgIdHeader !== undefined) {
    headers.set('x-org-id', opts.orgIdHeader);
  }
  const req = new Request('http://localhost/api/test', { headers });
  if (opts.cookieOrgId) {
    // Minimal NextRequest-like cookie shim
    Object.defineProperty(req, 'cookies', {
      value: { get: (name: string) => name === 'dashbi.activeOrgId' ? { value: opts.cookieOrgId } : undefined },
      configurable: true,
    });
  }
  return req;
}

describe('getAuthContext (Sprint 1.5 — session-based identity)', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockMembership.mockReset();
  });

  it('throws UnauthorizedError when there is no valid session', async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(getAuthContext(makeReq())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError when session has no user', async () => {
    mockGetSession.mockResolvedValue({ user: null });
    await expect(getAuthContext(makeReq())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('derives userId/orgId/role from session + membership, ignoring x-org-id header', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } });
    mockMembership.mockResolvedValue({ orgId: 'org-from-db', role: 'admin' });

    // Even if attacker sends x-org-id for ANOTHER org, we ignore it.
    const ctx = await getAuthContext(makeReq({ orgIdHeader: 'evil-org' }));

    expect(ctx).toEqual({
      userId: 'user-1',
      email: 'a@b.com',
      orgId: 'org-from-db',
      role: 'admin',
    });
    expect(mockMembership).toHaveBeenCalledTimes(1);
  });

  it('uses x-org-id as the membership lookup key when present', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } });
    mockMembership.mockResolvedValue({ orgId: 'org-explicit', role: 'editor' });

    await getAuthContext(makeReq({ orgIdHeader: 'org-explicit' }));

    expect(mockMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
      }),
    );
  });

  it('throws ForbiddenError when user is not a member of any org', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } });
    mockMembership.mockResolvedValue(null);

    await expect(getAuthContext(makeReq())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('requireAuth (Sprint 1.5)', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockMembership.mockReset();
  });

  it('throws ForbiddenError when role lacks the action', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } });
    mockMembership.mockResolvedValue({ orgId: 'org-1', role: 'viewer' });

    await expect(requireAuth(makeReq(), 'dashboard.create')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns context when role has the action', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } });
    mockMembership.mockResolvedValue({ orgId: 'org-1', role: 'admin' });

    const ctx = await requireAuth(makeReq(), 'dashboard.create');
    expect(ctx.role).toBe('admin');
  });
});