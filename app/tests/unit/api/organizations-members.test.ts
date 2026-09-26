import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAuth, mockWithOrgContext, mockAudit } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock('@/lib/auth/request', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/db/client', () => ({ withOrgContext: mockWithOrgContext }));
vi.mock('@/lib/audit/log', () => ({ audit: mockAudit }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from '@/app/api/organizations/members/route';
import { PATCH, DELETE } from '@/app/api/organizations/members/[id]/route';

describe('/api/organizations/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-admin',
      email: 'admin@example.com',
      orgId: 'org-1',
      role: 'admin',
    });
    mockAudit.mockResolvedValue(undefined);
  });

  describe('GET', () => {
    it('returns the members list for the active organization', async () => {
      const mockMembers = [
        {
          id: 'mem-1',
          userId: 'user-admin',
          role: 'admin',
          joinedAt: new Date(),
          invitedAt: new Date(),
          createdAt: new Date(),
          email: 'admin@example.com',
          name: 'Admin User',
          avatarUrl: null,
        },
        {
          id: 'mem-2',
          userId: 'user-editor',
          role: 'editor',
          joinedAt: new Date(),
          invitedAt: new Date(),
          createdAt: new Date(),
          email: 'editor@example.com',
          name: 'Editor User',
          avatarUrl: null,
        },
      ];

      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) =>
          fn({
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    orderBy: () => Promise.resolve(mockMembers),
                  }),
                }),
              }),
            }),
          }),
      );

      const req = new Request('http://localhost/api/organizations/members');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.members).toHaveLength(2);
      expect(json.currentUserId).toBe('user-admin');
      expect(json.currentUserRole).toBe('admin');
    });
  });

  describe('POST', () => {
    it('rejects invalid email formats', async () => {
      const req = new Request('http://localhost/api/organizations/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', role: 'editor' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('validation.invalid_format');
    });

    it('creates a new user if not exists and invites them to the org', async () => {
      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) => {
          let selectCallCount = 0;
          return fn({
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => {
                    selectCallCount++;
                    // 1st call: user lookup (not found)
                    if (selectCallCount === 1) return Promise.resolve([]);
                    // 2nd call: membership lookup (not found)
                    return Promise.resolve([]);
                  },
                }),
              }),
            }),
            insert: () => ({
              values: (vals: Record<string, unknown>) => ({
                returning: () => {
                  if (vals.email) {
                    return Promise.resolve([
                      { id: 'user-new', email: vals.email, name: vals.name, avatarUrl: null },
                    ]);
                  }
                  return Promise.resolve([
                    {
                      id: 'mem-new',
                      orgId: 'org-1',
                      userId: 'user-new',
                      role: vals.role,
                      joinedAt: new Date(),
                    },
                  ]);
                },
              }),
            }),
          });
        },
      );

      const req = new Request('http://localhost/api/organizations/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'newbie@example.com', role: 'viewer' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.member.email).toBe('newbie@example.com');
      expect(json.member.role).toBe('viewer');
      expect(mockAudit).toHaveBeenCalledTimes(1);
    });

    it('returns 409 conflict if user is already a member', async () => {
      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) => {
          let selectCallCount = 0;
          return fn({
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => {
                    selectCallCount++;
                    if (selectCallCount === 1) {
                      return Promise.resolve([
                        { id: 'user-existing', email: 'existing@example.com' },
                      ]);
                    }
                    return Promise.resolve([{ id: 'mem-existing' }]);
                  },
                }),
              }),
            }),
          });
        },
      );

      const req = new Request('http://localhost/api/organizations/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'existing@example.com', role: 'editor' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.code).toBe('member.already_exists');
    });
  });

  describe('PATCH /api/organizations/members/[id]', () => {
    it('updates member role', async () => {
      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) =>
          fn({
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => Promise.resolve([{ id: 'mem-2', role: 'viewer' }]),
                }),
              }),
            }),
            update: () => ({
              set: (vals: Record<string, unknown>) => ({
                where: () => ({
                  returning: () => Promise.resolve([{ id: 'mem-2', role: vals.role }]),
                }),
              }),
            }),
          }),
      );

      const req = new Request('http://localhost/api/organizations/members/mem-2', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'editor' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'mem-2' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.member.role).toBe('editor');
      expect(mockAudit).toHaveBeenCalledTimes(1);
    });

    it('prevents demoting the last admin in the organization', async () => {
      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) => {
          let callCount = 0;
          return fn({
            select: () => ({
              from: () => ({
                where: () => {
                  callCount++;
                  if (callCount === 1) {
                    return {
                      limit: () => Promise.resolve([{ id: 'mem-admin', role: 'admin' }]),
                    };
                  }
                  return Promise.resolve([{ count: 1 }]);
                },
              }),
            }),
          });
        },
      );

      const req = new Request('http://localhost/api/organizations/members/mem-admin', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'editor' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'mem-admin' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('member.last_admin');
    });
  });

  describe('DELETE /api/organizations/members/[id]', () => {
    it('removes member from organization', async () => {
      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) =>
          fn({
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => Promise.resolve([{ id: 'mem-2', role: 'viewer', userId: 'user-2' }]),
                }),
              }),
            }),
            delete: () => ({
              where: () => Promise.resolve(),
            }),
          }),
      );

      const req = new Request('http://localhost/api/organizations/members/mem-2', {
        method: 'DELETE',
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: 'mem-2' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockAudit).toHaveBeenCalledTimes(1);
    });

    it('prevents removing the last admin in the organization', async () => {
      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) => {
          let callCount = 0;
          return fn({
            select: () => ({
              from: () => ({
                where: () => {
                  callCount++;
                  if (callCount === 1) {
                    return {
                      limit: () => Promise.resolve([{ id: 'mem-admin', role: 'admin', userId: 'user-admin' }]),
                    };
                  }
                  return Promise.resolve([{ count: 1 }]);
                },
              }),
            }),
          });
        },
      );

      const req = new Request('http://localhost/api/organizations/members/mem-admin', {
        method: 'DELETE',
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: 'mem-admin' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('member.last_admin');
    });

    it('returns 404 when member does not exist', async () => {
      mockWithOrgContext.mockImplementationOnce(
        async (_orgId, _userId, _role, fn) =>
          fn({
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => Promise.resolve([]),
                }),
              }),
            }),
          }),
      );

      const req = new Request('http://localhost/api/organizations/members/mem-missing', {
        method: 'DELETE',
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: 'mem-missing' }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.code).toBe('member.not_found');
    });
  });
});
