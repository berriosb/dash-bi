import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@/lib/auth/context';

const { mockRequireAuth, mockRateLimit, mockTakeStore, mockWithSystemContext, mockWithOrgContext } = vi.hoisted(() => {
  const txMock = {
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'file-uuid-1' }]),
      }),
    })),
  };
  const mwc = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { id: 'file-uuid-1', targetTable: 'org_o1.sales' },
          ]),
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
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return {
    mockRequireAuth: vi.fn(),
    mockRateLimit: vi.fn(),
    mockTakeStore: vi.fn(),
    mockWithSystemContext: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    mockWithOrgContext: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mwc)),
  };
});

vi.mock('@/db/client', () => ({
  withSystemContext: mockWithSystemContext,
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

const validBody = {
  fileId: '11111111-2222-3333-4444-555555555555',
  name: 'Sales Q1',
  columns: [
    { name: 'id', type: 'number', nullable: false },
    { name: 'name', type: 'string', nullable: false },
  ],
};

describe('POST /api/files/commit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-attach the mock implementations after clearAllMocks() wiped them.
    const txMock = {
      insert: vi.fn(() => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'file-uuid-1' }]),
        }),
      })),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    mockWithSystemContext.mockImplementation(
      async (...args: unknown[]) => {
        // withSystemContext(fn) — 1 arg
        // The route always calls with 1 arg.
        const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
        return fn(txMock);
      },
    );
    const mwc = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: 'file-uuid-1', targetTable: 'org_o1.sales' },
            ]),
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
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    mockWithOrgContext.mockImplementation(
      async (...args: unknown[]) => {
        // withOrgContext(orgId, userId, [role,] fn) — 3 or 4 args.
        // The last arg is always the callback.
        const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
        return fn(mwc);
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
    // Override the mwc tx.select to return empty rows for the file lookup.
    const mwcEmpty = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
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
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    mockWithOrgContext.mockReset();
    mockWithOrgContext.mockImplementation(
      async (...args: unknown[]) => {
        const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
        return fn(mwcEmpty);
      },
    );
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

  it('runs the DDL inside withSystemContext', async () => {
    await POST(makeReq(validBody));
    // system context is where the DDL + row loading happens.
    expect(mockWithSystemContext).toHaveBeenCalled();
  });

  it('writes the data_sources row inside withOrgContext', async () => {
    await POST(makeReq(validBody));
    // The org context is called for the file lookup AND the data_sources insert.
    expect(mockWithOrgContext.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
