import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/dashboards/[id]/embed/route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const mockDashboard = {
  id: 'dash-embed-1',
  orgId: 'org-embed-1',
  title: 'Dashboard Embebible',
  widgets: [],
};

vi.mock('@/lib/auth/request', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  withOrgContext: vi.fn((orgId, userId, role, fn) =>
    fn({
      query: {
        dashboards: {
          findFirst: vi.fn(async () => mockDashboard),
        },
      },
    })
  ),
}));

vi.mock('@/lib/audit/log', () => ({
  audit: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/request';

describe('POST /api/dashboards/[id]/embed', () => {
  const secretKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', secretKey);
    vi.clearAllMocks();
  });

  it('returns 401 when request is unauthenticated', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError('No active session'));

    const req = new Request('http://localhost:3000/api/dashboards/dash-embed-1/embed', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'dash-embed-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks permission', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new ForbiddenError('Permiso denegado'));

    const req = new Request('http://localhost:3000/api/dashboards/dash-embed-1/embed', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'dash-embed-1' }) });
    expect(res.status).toBe(403);
  });

  it('creates an embed token and returns iframe snippet for authorized editor', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      userId: 'u1',
      email: 'u1@example.com',
      orgId: 'org-embed-1',
      role: 'admin',
    });

    const req = new Request('http://localhost:3000/api/dashboards/dash-embed-1/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allowedOrigins: ['https://client-portal.com'],
        theme: 'corporate',
        hideTitle: true,
        allowExport: false,
        expiresInDays: 30,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'dash-embed-1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.token.startsWith('emb_')).toBe(true);
    expect(data.embedUrl).toContain(`/embed/${data.token}`);
    expect(data.iframeSnippet).toContain('<iframe');
  });
});
