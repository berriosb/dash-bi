/**
 * T8 — the two handlers that leaked a raw `error.message` to the client.
 *
 * Both are the worst version of the finding, because the message they leaked
 * was infrastructure, not a validation note:
 *
 * - `POST /api/data-sources/[id]/test` calls `connector.testConnection()`, whose
 *   failure message is routinely a DSN fragment — host, port and Postgres role
 *   name. Any authenticated user who could press "test connection" could read
 *   them back. The route also hardcoded 500, so a 404 came back as a 500.
 *
 * - `POST /api/dashboards/templates/[id]/instantiate` forwarded whatever
 *   `instantiateTemplate` threw, always as a 400.
 *
 * `POST /api/dashboards/templates` gets a test of its own because its failure
 * mode was the opposite one: it reported EVERY error as 401 "No autorizado",
 * including bugs that have nothing to do with auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRequireAuth,
  mockResolveConnector,
  mockInstantiateTemplate,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockResolveConnector: vi.fn(),
  mockInstantiateTemplate: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/request', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/query-engine/resolve', () => ({
  resolveConnector: mockResolveConnector,
  DataSourceNotFoundError: class DataSourceNotFoundError extends Error {},
}));
vi.mock('@/lib/templates/service', () => ({ instantiateTemplate: mockInstantiateTemplate }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));
vi.mock('@/db/client', () => ({ withOrgContext: vi.fn(), db: {} }));

import { POST as testConnection } from '@/app/api/data-sources/[id]/test/route';
import { POST as instantiate } from '@/app/api/dashboards/templates/[id]/instantiate/route';
import { GET as listTemplates } from '@/app/api/dashboards/templates/route';

const ID = '00000000-0000-4000-a000-0000000000aa';

function ctx(): unknown {
  return {
    session: { user: { id: 'user-123' } },
    orgId: 'org-1',
    userId: 'user-123',
    role: 'owner',
  };
}

function post(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1' },
    body: JSON.stringify({}),
  });
}

describe('T8: no raw error.message reaches the client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(ctx());
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it('data-sources test does not leak a DSN fragment', async () => {
    mockResolveConnector.mockResolvedValue({
      testConnection: async () => {
        throw new Error(
          'connect ECONNREFUSED 10.0.4.17:5432: password authentication failed for user "dashbi_readonly"',
        );
      },
    });

    const res = await testConnection(post(`/api/data-sources/${ID}/test`), {
      params: Promise.resolve({ id: ID }),
    });
    const raw = await res.text();

    expect(raw).not.toContain('10.0.4.17');
    expect(raw).not.toContain('dashbi_readonly');
    expect(raw).not.toContain('ECONNREFUSED');
    // Canonical envelope.
    expect(JSON.parse(raw)).toHaveProperty('code');
    expect(JSON.parse(raw)).toHaveProperty('correlationId');
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('instantiate does not forward the thrown message', async () => {
    mockInstantiateTemplate.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "orgs_slug_idx"'),
    );

    const res = await instantiate(post('/api/dashboards/templates/t1/instantiate'), {
      params: Promise.resolve({ id: 't1' }),
    });
    const raw = await res.text();

    expect(raw).not.toContain('orgs_slug_idx');
    expect(JSON.parse(raw)).toHaveProperty('code');
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('templates GET stops reporting every failure as 401', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      Object.assign(new Error('templates catalog import failed'), {
        code: 'internal_server_error',
      }),
    );

    const res = await listTemplates(new Request('http://localhost/api/dashboards/templates'));
    const body = await res.json();

    // Before the fix this was `{ error: 'No autorizado' }` with a 401, for
    // any throw at all — so an internal fault looked like a session problem.
    expect(res.status).not.toBe(401);
    expect(body.code).toBe('internal_server_error');
  });

  it('templates GET still answers a genuine auth failure with 401', async () => {
    const { UnauthorizedError } = await import('@/lib/auth/context');
    mockRequireAuth.mockRejectedValueOnce(new UnauthorizedError('No active session'));

    const res = await listTemplates(new Request('http://localhost/api/dashboards/templates'));
    expect(res.status).toBe(401);
  });
});
