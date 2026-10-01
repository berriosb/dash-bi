import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@/lib/auth/context';

const { mockRequireAuth, mockWithOrgContext, mockRateLimit } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockRateLimit: vi.fn(),
}));

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

import { POST } from '@/app/api/files/upload/route';

function makeMultipartRequest(file: File | null = null): Request {
  const form = new FormData();
  if (file) {
    form.append('file', file);
  }
  return new Request('http://localhost/api/files/upload', {
    method: 'POST',
    body: form,
  });
}

function buildRawMultipart(filename: string, content: string, mime: string): Request {
  const boundary = '----TestBoundary123';
  const parts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mime}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ];
  const body = parts.join('\r\n');
  return new Request('http://localhost/api/files/upload', {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
}

describe('POST /api/files/upload', () => {
  // The tx handed to the `withOrgContext` callback, kept so the test can
  // inspect the `uploaded_files` insert the route performs inside it.
  let orgTx: {
    insert: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      email: 'a@b.com',
      orgId: 'org-1',
      role: 'admin',
    });
    mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    orgTx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([{ id: 'file-uuid-1' }]),
        }),
      }),
    };
    mockWithOrgContext.mockImplementation(
      async (...args: unknown[]) => {
        // withOrgContext(orgId, userId, [role,] fn) — the last arg is the callback.
        const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
        return fn(orgTx);
      },
    );
  });

  it('returns 401 when there is no authenticated session', async () => {
    mockRequireAuth.mockRejectedValueOnce(new UnauthorizedError());
    const csv = new File(['name\nAlice\n'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeMultipartRequest(csv));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate-limited', async () => {
    mockRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 30 });
    const csv = new File(['name\nAlice\n'], 'test.csv', { type: 'text/csv' });
    const res = await POST(makeMultipartRequest(csv));
    expect(res.status).toBe(429);
  });

  it('returns 201 with preview when uploading a small CSV', async () => {
    const req = buildRawMultipart('sales.csv', 'name,age\r\nAlice,30\r\nBob,25\r\n', 'text/csv');
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fileId).toBe('file-uuid-1');
    expect(body.format).toBe('csv');
    expect(body.name).toBe('sales.csv');
    expect(body.totalRows).toBe(2);
    expect(body.inferredColumns).toHaveLength(2);
    expect(body.previewRows).toHaveLength(2);
  });

  it('inserts the uploaded_files row under the caller org', async () => {
    const req = buildRawMultipart('sales.csv', 'name,age\r\nAlice,30\r\n', 'text/csv');
    await POST(req);

    expect(mockWithOrgContext).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'admin',
      expect.any(Function),
    );
    const inserted = (
      orgTx.insert.mock.results[0]?.value as {
        values: ReturnType<typeof vi.fn>;
      }
    ).values.mock.calls[0]?.[0] as {
      orgId: string;
      originalFilename: string;
      targetTable: string;
      rowCount: number;
      createdBy: string;
    };
    expect(inserted.orgId).toBe('org-1');
    expect(inserted.createdBy).toBe('user-1');
    expect(inserted.originalFilename).toBe('sales.csv');
    expect(inserted.targetTable).toBe('org_org1.sales');
    expect(inserted.rowCount).toBe(1);
  });

  it('returns 413 when the file exceeds the size cap', async () => {
    // 100MB + 1 byte
    const oversized = new File(
      [new Uint8Array(100 * 1024 * 1024 + 1)],
      'big.csv',
      { type: 'text/csv' },
    );
    const res = await POST(makeMultipartRequest(oversized));
    expect(res.status).toBe(413);
  });

  it('returns 400 when the file has no rows', async () => {
    const empty = new File([''], 'empty.csv', { type: 'text/csv' });
    const res = await POST(makeMultipartRequest(empty));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the multipart body has no file part', async () => {
    const boundary = '----TestBoundary456';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nfoo\r\n--${boundary}--\r\n`;
    const req = new Request('http://localhost/api/files/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
