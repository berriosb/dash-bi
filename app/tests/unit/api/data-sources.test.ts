import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

// Sprint 1.5: los route handlers ya no leen `x-org-id`/`x-user-id` del
// request. Derivan identidad de la sesión via `requireAuth`, que mockeamos.
const { mockRequireAuth, mockDbInsert, mockWithOrgContext } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockDbInsert: vi.fn(),
  mockWithOrgContext: vi.fn(
    async (..._args: unknown[]) => undefined
  ),
}));

vi.mock('@/db/client', () => ({
  db: { insert: mockDbInsert },
  withOrgContext: mockWithOrgContext,
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
}));


vi.mock('@/lib/audit/log', () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));


vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));


import { POST } from '@/app/api/data-sources/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/data-sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/data-sources — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReset();
    mockWithOrgContext.mockReset();
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      email: 'a@b.com',
      orgId: 'org-1',
      role: 'admin',
    });
    (mockWithOrgContext as unknown as { mockImplementation: (impl: (...args: unknown[]) => Promise<unknown>) => void }).mockImplementation((...args: unknown[]) => {
      const fn = args[3] as (t: unknown) => Promise<unknown>;
      return fn({ insert: mockDbInsert });
    });
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          { id: 'ds-test-1', name: 'Test', type: 'postgres', createdAt: new Date() },
        ]),
      }),
    });
  });

  it('returns 401 when there is no authenticated session', async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new UnauthorizedError()
    );
    const res = await POST(makeReq({ name: 'X', type: 'postgres', config: {} }));
    expect(res.status).toBe(401);
  });

  it('rejects body without name', async () => {
    const res = await POST(makeReq({ type: 'postgres', config: {} }));
    expect(res.status).toBe(400);
  });

  it('rejects invalid type', async () => {
    const res = await POST(
      makeReq({ name: 'X', type: 'mongodb', config: {} }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects postgres config with localhost (SSRF)', async () => {
    const res = await POST(
      makeReq({
        name: 'Test',
        type: 'postgres',
        config: {
          host: 'localhost',
          port: 5432,
          database: 'main',
          username: 'user',
          password: 'pass',
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('connector.ssrf_blocked');
  });

  it('rejects postgres config with private IP (SSRF)', async () => {
    const res = await POST(
      makeReq({
        name: 'Test',
        type: 'postgres',
        config: {
          host: '10.0.0.1',
          port: 5432,
          database: 'main',
          username: 'user',
          password: 'pass',
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects postgres config with AWS metadata endpoint', async () => {
    const res = await POST(
      makeReq({
        name: 'Test',
        type: 'postgres',
        config: {
          host: '169.254.169.254',
          port: 5432,
          database: 'main',
          username: 'user',
          password: 'pass',
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects stripe config with invalid key format', async () => {
    const res = await POST(
      makeReq({
        name: 'Test',
        type: 'stripe',
        config: { apiKey: 'not-a-stripe-key' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation.invalid_format');
  });

  it('rejects sheets config with missing spreadsheetId', async () => {
    const res = await POST(
      makeReq({
        name: 'Test',
        type: 'sheets',
        config: {},
      }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts valid postgres config with public host', async () => {
    const res = await POST(
      makeReq({
        name: 'Production DB',
        type: 'postgres',
        config: {
          host: 'db.acme.com',
          port: 5432,
          database: 'production',
          username: 'reader',
          password: 'secret123',
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dataSource?.id).toBe('ds-test-1');
  });

  it('accepts valid stripe config with sk_live_ prefix', async () => {
    const res = await POST(
      makeReq({
        name: 'Stripe prod',
        type: 'stripe',
        config: { apiKey: 'sk_live_aaaaaaaaaaaaaaaaaaaaaaa' },
      }),
    );
    expect(res.status).toBe(201);
  });

  it('accepts valid sheets config with spreadsheetId', async () => {
    const res = await POST(
      makeReq({
        name: 'Sheets Q3',
        type: 'sheets',
        config: {
          spreadsheetId: '1BxiMVs0XRAb4NcF4abcdefghijk',
        },
      }),
    );
    expect(res.status).toBe(201);
  });

  it('writes audit log entry on success', async () => {
    const { audit } = await import('@/lib/audit/log');
    await POST(
      makeReq({
        name: 'Production DB',
        type: 'postgres',
        config: {
          host: 'db.acme.com',
          port: 5432,
          database: 'production',
          username: 'reader',
          password: 'secret123',
        },
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'datasource.created',
      'datasource:ds-test-1',
      expect.objectContaining({ metadata: expect.objectContaining({ name: 'Production DB', type: 'postgres' }) })
    );
  });
});
