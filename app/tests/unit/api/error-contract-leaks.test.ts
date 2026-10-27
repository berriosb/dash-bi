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
 *
 * T4 (ODD task 4) closes the sibling hole of the first bullet: the connector
 * test RESOLVES with `{ ok: false, error: <driver message> }` when the
 * connection fails — it does not throw — so `errorResponse()` never saw it
 * and the raw driver text reached the client through the route's success
 * path. The NLQA execution path had the same shape: `execErr.message` was
 * returned verbatim right next to a sanitized `ValidationError` branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as QueryEngineExecute from '@/lib/query-engine/execute';

const {
  mockRequireAuth,
  mockResolveConnector,
  mockInstantiateTemplate,
  mockCheckRateLimit,
  mockWithOrgContext,
  mockLogger,
  mockExecuteWithTimeout,
  mockGenerateNLQASql,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockResolveConnector: vi.fn(),
  mockInstantiateTemplate: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  mockExecuteWithTimeout: vi.fn(),
  mockGenerateNLQASql: vi.fn(),
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
vi.mock('@/db/client', () => ({ withOrgContext: mockWithOrgContext, db: {} }));
vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  logRequest: vi.fn(() => ({ correlationId: 'req_test', logger: mockLogger })),
}));
vi.mock('@/lib/audit/log', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/ai/quota', () => ({
  recordLLMUsage: vi.fn().mockResolvedValue(undefined),
  assertOrgCanSpendLlm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/ai/gateway', () => ({
  // The route builds `new AiGateway(...)`. Vitest 4 checks that the
  // implementation is constructible before applying `new`, so this is a
  // regular function, not an arrow.
  AiGateway: vi.fn().mockImplementation(function () {
    return { generateNLQASql: mockGenerateNLQASql };
  }),
}));
vi.mock('@/lib/query-engine/execute', async (importOriginal) => {
  // `toUserError` does `instanceof QueryTimeoutError`, so the error classes
  // have to stay real — only the execution call is mocked.
  const actual = await importOriginal<typeof QueryEngineExecute>();
  return { ...actual, executeWithTimeout: mockExecuteWithTimeout };
});

import { POST as testConnection } from '@/app/api/data-sources/[id]/test/route';
import { POST as instantiate } from '@/app/api/dashboards/templates/[id]/instantiate/route';
import { GET as listTemplates } from '@/app/api/dashboards/templates/route';
import { POST as nlqaAsk } from '@/app/api/nlqa/ask/route';

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

function ask(body: unknown): Request {
  return new Request('http://localhost/api/nlqa/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1' },
    body: JSON.stringify(body),
  });
}

/**
 * Minimal stand-in for the Drizzle transaction the NLQA route gets from
 * `withOrgContext`. The route only ever awaits the result of a chain, so a
 * row array that also carries `orderBy` is enough: `await` on a plain array
 * resolves to the array itself, and the message-history query chains
 * `.orderBy().limit()` off `where()`.
 */
function fakeTx() {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 'row-1' }],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => {
          const rows: unknown[] = [];
          return Object.assign(rows, {
            orderBy: () => ({ limit: async () => [] }),
          });
        },
      }),
    }),
  };
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

/**
 * T4 — the driver internals must not reach the client.
 *
 * `connector.testConnection()` does not throw when the connection fails: it
 * RESOLVES with `{ ok: false, error: <the driver's own message> }`. The route
 * returned that object verbatim, so the raw text (`getaddrinfo ENOTFOUND
 * db.internal`, `password authentication failed for user "dashbi_readonly"`)
 * went to the client even though `errorResponse()` sanitizes every THROWN
 * error. `datasource.view` is granted to viewers, so this was a repeatable
 * reconnaissance channel for any read-only member.
 *
 * The same leak existed on the NLQA execution path, where `execErr.message`
 * was returned verbatim next to a sanitized `ValidationError` branch.
 */
describe('T4: driver internals never reach the client', () => {
  const DRIVER_ERROR = 'password authentication failed for user "dashbi_readonly"';

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(ctx());
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
      const fn = args[3] as (tx: unknown) => Promise<unknown>;
      return fn(fakeTx());
    });
    mockGenerateNLQASql.mockResolvedValue({
      sql: 'SELECT 1',
      params: [],
      usage: { promptTokens: 10, completionTokens: 5 },
    });
  });

  it('data-sources test hides the driver message it RESOLVES with', async () => {
    mockResolveConnector.mockResolvedValue({
      testConnection: async () => ({ ok: false, latencyMs: 12, error: DRIVER_ERROR }),
    });

    const res = await testConnection(post(`/api/data-sources/${ID}/test`), {
      params: Promise.resolve({ id: ID }),
    });
    const raw = await res.text();

    // The driver text and the role name are reconnaissance, not copy.
    expect(raw).not.toContain('password authentication failed');
    expect(raw).not.toContain('dashbi_readonly');

    const body = JSON.parse(raw);
    // A stable machine code the client can branch on...
    expect(body.error).toBe('connection_failed');
    // ...and a curated message the user can read. An empty body would pass
    // the "does not contain the secret" assertions above, and that is not an
    // acceptable outcome: the user has to learn what happened.
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    // The rest of the contract is unchanged.
    expect(body.ok).toBe(false);
    expect(body.latencyMs).toBe(12);
  });

  it('data-sources test keeps the success shape', async () => {
    mockResolveConnector.mockResolvedValue({
      testConnection: async () => ({ ok: true, latencyMs: 30 }),
    });

    const res = await testConnection(post(`/api/data-sources/${ID}/test`), {
      params: Promise.resolve({ id: ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, latencyMs: 30 });
  });

  it('data-sources test keeps the detail server-side, with the context', async () => {
    mockResolveConnector.mockResolvedValue({
      testConnection: async () => ({ ok: false, latencyMs: 12, error: DRIVER_ERROR }),
    });

    await testConnection(post(`/api/data-sources/${ID}/test`), {
      params: Promise.resolve({ id: ID }),
    });

    // The detail is not lost — it moves to the log, with the context the
    // route already has.
    expect(mockLogger.warn).toHaveBeenCalled();
    const [payload, message] = mockLogger.warn.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(payload.dataSourceId).toBe(ID);
    expect(payload.orgId).toBe('org-1');
    expect(payload.userId).toBe('user-123');
    expect(JSON.stringify(payload)).toContain('dashbi_readonly');
    expect(message).toBeTruthy();
  });

  it('data-sources test keeps a password-bearing DSN out of the log', async () => {
    mockResolveConnector.mockResolvedValue({
      testConnection: async () => ({
        ok: false,
        latencyMs: 7,
        error: 'could not connect to postgresql://dashbi:sup3rs3cret@db.internal:5432/prod',
      }),
    });

    await testConnection(post(`/api/data-sources/${ID}/test`), {
      params: Promise.resolve({ id: ID }),
    });

    expect(mockLogger.warn).toHaveBeenCalled();
    const logged = JSON.stringify(mockLogger.warn.mock.calls);
    expect(logged).not.toContain('sup3rs3cret');
    // The host is still useful for the operator reading the log.
    expect(logged).toContain('db.internal');
  });

  it('nlqa ask hides the driver message from the execution path', async () => {
    mockResolveConnector.mockResolvedValue({
      type: 'postgres',
      getSchema: async () => ({ tables: [] }),
    });
    mockExecuteWithTimeout.mockRejectedValue(new Error(DRIVER_ERROR));

    const res = await nlqaAsk(
      ask({
        dataSourceId: '11111111-1111-4111-8111-111111111111',
        question: '¿Cuánto facturamos este mes?',
      }),
    );
    const raw = await res.text();

    expect(raw).not.toContain('password authentication failed');
    expect(raw).not.toContain('dashbi_readonly');

    const body = JSON.parse(raw);
    expect(body.error).toBe('query_execution_failed');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.message).not.toContain('dashbi_readonly');
    expect(res.status).toBe(500);
  });

  it('nlqa ask keeps the execution reason server-side, redacted', async () => {
    mockResolveConnector.mockResolvedValue({
      type: 'postgres',
      getSchema: async () => ({ tables: [] }),
    });
    mockExecuteWithTimeout.mockRejectedValue(new Error(DRIVER_ERROR));

    await nlqaAsk(
      ask({
        dataSourceId: '11111111-1111-4111-8111-111111111111',
        question: '¿Cuánto facturamos este mes?',
      }),
    );

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCalls = mockLogger.error.mock.calls as [Record<string, unknown>, string][];
    const payload = errorCalls.find(
      ([fields]) => fields.dataSourceId === '11111111-1111-4111-8111-111111111111',
    )?.[0];
    expect(payload).toBeDefined();
    expect(payload?.orgId).toBe('org-1');
    expect(payload?.userId).toBe('user-123');
    expect(JSON.stringify(payload)).toContain('dashbi_readonly');
  });

  it('nlqa ask still answers a policy rejection with 422, not the reason', async () => {
    const { ValidationError } = await import('@/lib/security/validate-query');
    mockResolveConnector.mockResolvedValue({
      type: 'postgres',
      getSchema: async () => ({ tables: [] }),
    });
    mockExecuteWithTimeout.mockRejectedValue(
      new ValidationError('Role viewer cannot access sensitive columns (PII protection)'),
    );

    const res = await nlqaAsk(
      ask({
        dataSourceId: '11111111-1111-4111-8111-111111111111',
        question: '¿Cuánto facturamos este mes?',
      }),
    );
    const raw = await res.text();
    const body = JSON.parse(raw);

    expect(res.status).toBe(422);
    expect(body.error).toBe('sql_validation_failed');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(raw).not.toContain('sensitive columns');
  });
});
