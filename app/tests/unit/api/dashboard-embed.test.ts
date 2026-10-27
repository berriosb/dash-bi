import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/dashboards/[id]/embed/route';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';
import { NextRequest } from 'next/server';

const mockDashboard = {
  id: 'dash-embed-1',
  orgId: 'org-embed-1',
  title: 'Dashboard Embebible',
  widgets: [
    {
      id: 'w-1',
      type: 'kpi',
      position: { col: 1, row: 1, colSpan: 6, rowSpan: 1 },
      config: { title: 'Ingresos netos' },
      data: { value: 128400, delta: 8.4 },
      source: {
        kind: 'query',
        dataSourceId: 'ds-internal-42',
        query: {
          kind: 'sql',
          sql: "SELECT sum(total) FROM sales JOIN customers ON sales.customer_id = customers.id WHERE region = 'EMEA'",
        },
      },
    },
  ],
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
import { getEmbedDashboard } from '@/lib/embed/get-embed-dashboard';
import { generateEmbedToken } from '@/lib/embed/token';
import { middleware, config as middlewareConfig } from '@/middleware';

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

/**
 * Security P0 (task 6): an embed is rendered for an anonymous third-party
 * site. The stored widget carries the query that produced its data —
 * `source.query.sql` and `source.dataSourceId` — so shipping the widget
 * verbatim hands that site the tenant's table names, column names, join
 * logic and business filters. The dashboard renders from the pre-hydrated
 * `data`, so the SQL is never needed to draw it.
 */
describe('getEmbedDashboard — embed payload (security P0 task 6)', () => {
  const secretKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', secretKey);
    vi.clearAllMocks();
  });

  it('does not ship the widget query (SQL + data source id) to the embedding site', async () => {
    const { token } = await generateEmbedToken({
      dashboardId: 'dash-embed-1',
      orgId: 'org-embed-1',
      allowedOrigins: ['https://client-portal.com'],
    });

    const result = await getEmbedDashboard(token, 'https://client-portal.com');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SELECT sum(total)');
    expect(serialized).not.toContain('ds-internal-42');
    expect(serialized).not.toContain('dataSourceId');
    expect(serialized).not.toContain('source');

    const widgets = result.dashboard.widgets as Record<string, unknown>[];
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).not.toHaveProperty('source');
    expect(widgets[0]).not.toHaveProperty('dataSourceId');
  });

  it('keeps the widget fields the renderer needs', async () => {
    const { token } = await generateEmbedToken({
      dashboardId: 'dash-embed-1',
      orgId: 'org-embed-1',
      allowedOrigins: ['https://client-portal.com'],
    });

    const result = await getEmbedDashboard(token, 'https://client-portal.com');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    // A fix that dropped the whole widget would satisfy "no source" and
    // render an empty dashboard. The renderer needs these fields.
    const widgets = result.dashboard.widgets as Record<string, unknown>[];
    expect(widgets[0]).toMatchObject({
      id: 'w-1',
      type: 'kpi',
      position: { col: 1, row: 1, colSpan: 6, rowSpan: 1 },
      config: { title: 'Ingresos netos' },
      data: { value: 128400, delta: 8.4 },
    });
  });

  it('keeps cspHeader in the payload — the embed view consumes it as a prop', async () => {
    const { token } = await generateEmbedToken({
      dashboardId: 'dash-embed-1',
      orgId: 'org-embed-1',
      allowedOrigins: ['https://client-portal.com'],
    });

    const result = await getEmbedDashboard(token, 'https://client-portal.com');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.config.cspHeader).toBe('frame-ancestors https://client-portal.com;');
  });
});

/**
 * Security P0 (task 6): `getCspFrameAncestors` computed a `frame-ancestors`
 * list that was only ever passed to a client component as a prop, so the
 * embed route had no browser-side framing restriction at all. The middleware
 * now emits it as a response header, scoped to the token's own origins.
 */
describe('middleware — embed CSP header (security P0 task 6)', () => {
  const secretKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', secretKey);
    vi.clearAllMocks();
  });

  it('emits frame-ancestors scoped to the token allowed origins', async () => {
    const { token } = await generateEmbedToken({
      dashboardId: 'dash-embed-1',
      orgId: 'org-embed-1',
      allowedOrigins: ['https://portal.client.com'],
    });

    const req = new NextRequest(`http://localhost:3000/embed/${token}`, {
      headers: { origin: 'https://portal.client.com' },
    });
    const res = await middleware(req);

    // The middleware only sets the header; it never rejects the embed.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(
      'frame-ancestors https://portal.client.com;'
    );
  });

  it('falls back to the strictest value when the token cannot be verified', async () => {
    const req = new NextRequest('http://localhost:3000/embed/emb_forged.signature', {
      headers: { origin: 'https://portal.client.com' },
    });
    const res = await middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none';");
    expect(res.headers.get('content-security-policy')).not.toContain('*');
  });

  it('runs the middleware for /embed/* even though the token contains a dot', () => {
    // The global matcher excludes any path with a dot in it ("a file with an
    // extension"). The embed token is `emb_<payload>.<signature>`, so
    // without an explicit /embed entry the middleware never runs for an
    // embed and the CSP header is never emitted.
    expect(middlewareConfig.matcher).toContain('/embed/:path*');
  });
});
