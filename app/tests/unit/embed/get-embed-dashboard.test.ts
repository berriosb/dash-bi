import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmbedDashboard } from '@/lib/embed/get-embed-dashboard';
import { generateEmbedToken } from '@/lib/embed/token';

const mockDashboard = {
  id: 'd-101',
  orgId: 'o-202',
  title: 'Ventas Q3',
  description: 'Métricas de ventas',
  theme: 'moderno-saas',
  widgets: [{ id: 'w1', type: 'kpi', title: 'MRR', queryId: 'q1', config: {} }],
};

vi.mock('@/db/client', () => ({
  withOrgContext: vi.fn((orgId, userId, role, fn) =>
    fn({
      query: {
        dashboards: {
          findFirst: vi.fn(async ({ where }: { where: unknown }) => {
            return mockDashboard;
          }),
        },
      },
    })
  ),
  withSystemContext: vi.fn((fn) => fn({})),
}));

vi.mock('@/lib/audit/log', () => ({
  audit: vi.fn(),
}));

describe('getEmbedDashboard', () => {
  const secretKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', secretKey);
  });

  it('resolves a valid embed token to dashboard details and embed configuration', async () => {
    const { token } = await generateEmbedToken({
      dashboardId: 'd-101',
      orgId: 'o-202',
      allowedOrigins: ['https://portal.client.com'],
      theme: 'corporate',
      hideTitle: true,
      allowExport: false,
    });

    const result = await getEmbedDashboard(token, 'https://portal.client.com');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.dashboard.id).toBe('d-101');
      expect(result.dashboard.title).toBe('Ventas Q3');
      expect(result.config.theme).toBe('corporate');
      expect(result.config.hideTitle).toBe(true);
      expect(result.config.cspHeader).toContain('frame-ancestors https://portal.client.com;');
    }
  });

  it('rejects invalid or tampered tokens', async () => {
    const result = await getEmbedDashboard('invalid-token-string');
    expect(result.status).toBe('invalid_token');
  });

  it('rejects an expired token', async () => {
    const { token } = await generateEmbedToken({
      dashboardId: 'd-101',
      orgId: 'o-202',
      allowedOrigins: ['*'],
      expiresAt: new Date(Date.now() - 10000).toISOString(),
    });

    const result = await getEmbedDashboard(token);
    expect(result.status).toBe('expired');
  });

  it('rejects requests from unauthorized origin', async () => {
    const { token } = await generateEmbedToken({
      dashboardId: 'd-101',
      orgId: 'o-202',
      allowedOrigins: ['https://authorized.com'],
    });

    const result = await getEmbedDashboard(token, 'https://unauthorized.org');
    expect(result.status).toBe('invalid_origin');
  });
});
