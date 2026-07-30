import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';
import { NextResponse } from 'next/server';

// Sprint 1.5 — verificar que `errorResponse` (helper que viven en cada
// route handler) usa el contrato AppError correcto. Esto fija el
// invariante "toda API route devuelve el shape errors-ux.md §2.1".

const { mockGetOrGenerateCorrelationId, mockToUserError, mockStatusFromCode } = vi.hoisted(() => ({
  mockGetOrGenerateCorrelationId: vi.fn(),
  mockToUserError: vi.fn(),
  mockStatusFromCode: vi.fn(),
}));

vi.mock('@/lib/errors/to-user-error', () => ({
  getOrGenerateCorrelationId: mockGetOrGenerateCorrelationId,
  toUserError: mockToUserError,
}));


vi.mock('@/lib/errors/types', () => ({
  statusFromCode: mockStatusFromCode,
}));


vi.mock('@/lib/auth/request', () => ({
  requireAuth: vi.fn(),
}));


vi.mock('@/db/client', () => ({
  withOrgContext: vi.fn(async (_orgId: string, _userId: string | null, _role: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));


import { POST } from '@/app/api/dashboards/route';

describe('Sprint 1.5 — errorResponse contract (errors-ux.md §2.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrGenerateCorrelationId.mockReturnValue('req_test-correlation');
    mockToUserError.mockReturnValue({
      code: 'internal_server_error',
      message: 'Algo salió mal',
      correlationId: 'req_test-correlation',
      retryable: true,
    });
    mockStatusFromCode.mockReturnValue(500);
  });

  it('routes always return the AppError shape on error', async () => {
    const { requireAuth } = await import('@/lib/auth/request');
    (requireAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('boom'), { name: 'InternalError' })
    );

    const res = await POST(new Request('http://localhost/api/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 'internal_server_error',
      correlationId: 'req_test-correlation',
      retryable: true,
    });
    expect(res.headers.get('x-correlation-id')).toBe('req_test-correlation');
  });

  it('maps UnauthorizedError → 401', async () => {
    const { requireAuth } = await import('@/lib/auth/request');
    mockToUserError.mockReturnValueOnce({
      code: 'auth.unauthorized',
      message: 'Tu sesión expiró',
      correlationId: 'req_test-correlation',
      retryable: false,
    });
    mockStatusFromCode.mockReturnValueOnce(401);
    (requireAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new UnauthorizedError()
    );

    const res = await POST(new Request('http://localhost/api/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('auth.unauthorized');
  });

  it('maps ForbiddenError → 403', async () => {
    const { requireAuth } = await import('@/lib/auth/request');
    mockToUserError.mockReturnValueOnce({
      code: 'auth.forbidden',
      message: 'No tenés permisos',
      correlationId: 'req_test-correlation',
      retryable: false,
    });
    mockStatusFromCode.mockReturnValueOnce(403);
    (requireAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('Role viewer cannot perform dashboard.create'), { name: 'ForbiddenError' })
    );

    const res = await POST(new Request('http://localhost/api/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    }));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('auth.forbidden');
  });
});
