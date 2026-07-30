import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/dashboards/templates/route';
import { POST } from '@/app/api/dashboards/templates/[id]/instantiate/route';

vi.mock('@/lib/auth/request', () => ({
  requireAuth: vi.fn(() =>
    Promise.resolve({
      userId: 'usr_test_1',
      orgId: 'org_test_1',
      role: 'admin',
    }),
  ),
}));

vi.mock('@/lib/templates/service', () => ({
  instantiateTemplate: vi.fn(() =>
    Promise.resolve({
      id: 'dash_template_999',
      orgId: 'org_test_1',
      title: 'SaaS MRR Analytics',
      theme: 'moderno-saas',
      archetype: 'kpi-grid',
      widgets: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  ),
}));

describe('/api/dashboards/templates routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/dashboards/templates returns 200 with catalog list', async () => {
    const req = new Request('http://localhost:3000/api/dashboards/templates');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.templates).toBeDefined();
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body.templates.length).toBeGreaterThanOrEqual(5);
  });

  it('POST /api/dashboards/templates/[id]/instantiate creates dashboard from template', async () => {
    const req = new Request('http://localhost:3000/api/dashboards/templates/saas-mrr-analytics/instantiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Mi Dashboard Personalizado' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'saas-mrr-analytics' }) });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.dashboard).toBeDefined();
    expect(body.dashboard.id).toBe('dash_template_999');
  });
});
