import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@/lib/auth/context';

const { mockRequireAuth, mockRateLimit, mockTakeStore, mockWithOrgContext, makeOrgTx } = vi.hoisted(() => {
  // One tx object serves every `withOrgContext` callback in the route:
  // the file lookup needs `select`, the DDL and `loadRows` need `execute`,
  // and the `data_sources` insert needs `insert`.
  const makeOrgTx = (
    fileRows: Array<{ id: string; targetTable: string }> = [
      { id: 'file-uuid-1', targetTable: 'org_o1.sales' },
    ],
  ) => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(fileRows),
        }),
      }),
    }),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'ds-new-1' }]),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })),
    execute: vi.fn().mockResolvedValue([]),
  });
  return {
    mockRequireAuth: vi.fn(),
    mockRateLimit: vi.fn(),
    mockTakeStore: vi.fn(),
    makeOrgTx,
    mockWithOrgContext: vi.fn(),
  };
});

vi.mock('@/db/client', () => ({
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockRateLimit,
}));

vi.mock('@/lib/audit/log', () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/connectors/parsers/commit-store', () => ({
  takeParsedForCommit: mockTakeStore,
}));

import { POST } from '@/app/api/files/commit/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/files/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * The route issues its DDL and its row load as `sql.raw(...)` statements,
 * so the executable text lives in the SQL object's `queryChunks` rather than
 * in a string field. This recovers the text for assertions.
 */
function rawSqlText(statement: unknown): string {
  const chunks = (statement as { queryChunks?: Array<{ value?: unknown }> })
    .queryChunks;
  if (!chunks) return '';
  return chunks
    .flatMap((chunk) =>
      Array.isArray(chunk.value) ? (chunk.value as unknown[]) : [chunk.value],
    )
    .filter((part): part is string => typeof part === 'string')
    .join('');
}

const validBody = {
  fileId: '11111111-2222-3333-4444-555555555555',
  name: 'Sales Q1',
  columns: [
    { name: 'id', type: 'number', nullable: false },
    { name: 'name', type: 'string', nullable: false },
  ],
};

describe('POST /api/files/commit', () => {
  // The tx handed to the `withOrgContext` callback. Swapped per test.
  let orgTx: ReturnType<typeof makeOrgTx>;

  const executedSql = (): string[] =>
    orgTx.execute.mock.calls.map(([statement]) => rawSqlText(statement));

  beforeEach(() => {
    vi.clearAllMocks();
    orgTx = makeOrgTx();
    // withOrgContext(orgId, userId, [role,] fn) — the last arg is the callback.
    // The mock reads the current `orgTx` at call time so tests can swap it.
    mockWithOrgContext.mockImplementation(
      async (...args: unknown[]) => {
        const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
        return fn(orgTx);
      },
    );
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      email: 'a@b.com',
      orgId: 'org-1',
      role: 'admin',
    });
    mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockTakeStore.mockReturnValue({
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      format: 'csv',
    });
  });

  it('returns 401 when there is no authenticated session', async () => {
    mockRequireAuth.mockRejectedValueOnce(new UnauthorizedError());
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the body is missing required fields', async () => {
    const res = await POST(makeReq({ name: 'X' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the fileId is not a UUID', async () => {
    const res = await POST(makeReq({ ...validBody, fileId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when columns is empty', async () => {
    const res = await POST(makeReq({ ...validBody, columns: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 410 when the upload session has expired', async () => {
    mockTakeStore.mockReturnValueOnce(undefined);
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(410);
  });

  it('returns 404 when the uploaded file no longer exists', async () => {
    // The file lookup happens in the org context and finds no row.
    orgTx = makeOrgTx([]);
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(404);
  });

  it('returns 201 with dataSourceId and rowCount on the happy path', async () => {
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dataSourceId).toBe('ds-new-1');
    expect(body.rowCount).toBe(2);
  });

  it('issues the DDL and the row load through tx.execute on the org-scoped tx', async () => {
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(201);

    const statements = executedSql();
    expect(statements).toContain('CREATE SCHEMA IF NOT EXISTS "org_o1"');
    expect(
      statements.some((s) =>
        s.startsWith('CREATE TABLE IF NOT EXISTS "org_o1"."sales"'),
      ),
    ).toBe(true);
    expect(statements).toContain(
      'ALTER TABLE "org_o1"."sales" ENABLE ROW LEVEL SECURITY',
    );
    expect(
      statements.some((s) =>
        s.includes('CREATE POLICY "org_isolation_sales" ON "org_o1"."sales"'),
      ),
    ).toBe(true);
    expect(statements).toContain(
      'CREATE INDEX IF NOT EXISTS "sales_name_idx" ON "org_o1"."sales"("name")',
    );
    // The parsed rows are loaded through the same org-scoped tx, so the
    // per-table RLS policy sees the caller's org on every INSERT.
    expect(
      statements.some((s) => s.startsWith('INSERT INTO "org_o1"."sales"')),
    ).toBe(true);
    expect(
      statements.some((s) => s.includes("('org-1', 1, 'Alice')")),
    ).toBe(true);
  });

  it('writes the data_sources row inside withOrgContext', async () => {
    await POST(makeReq(validBody));
    // The org context is called for the file lookup, the DDL, the row load
    // AND the data_sources insert.
    expect(mockWithOrgContext.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(orgTx.insert).toHaveBeenCalledTimes(1);
    const insertedValues = (
      orgTx.insert.mock.results[0]?.value as {
        values: ReturnType<typeof vi.fn>;
      }
    ).values.mock.calls[0]?.[0] as {
      orgId: string;
      type: string;
      name: string;
    };
    expect(insertedValues.orgId).toBe('org-1');
    expect(insertedValues.type).toBe('csv');
    expect(insertedValues.name).toBe('Sales Q1');
  });
});
