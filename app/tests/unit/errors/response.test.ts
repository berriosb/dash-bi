import { describe, it, expect } from 'vitest';
import { errorResponse } from '@/lib/errors/response';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';
import { AppErrorException } from '@/lib/errors/types';

const CORRELATION = 'req_test-abc123';

function reqWith(correlationId: string | null = CORRELATION): Request {
  return new Request('https://dashbi.test/api/x', {
    headers: correlationId ? { 'x-correlation-id': correlationId } : {},
  });
}

describe('errorResponse', () => {
  it('returns the catalog httpStatus for the mapped error code', async () => {
    const res = errorResponse(new UnauthorizedError('no sesion'), reqWith());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe('auth.unauthorized');
  });

  it('echoes the inbound correlation id in the x-correlation-id header', () => {
    const res = errorResponse(new UnauthorizedError('no sesion'), reqWith());

    expect(res.headers.get('x-correlation-id')).toBe(CORRELATION);
  });

  it('reuses the same correlation id in the body and the header', async () => {
    const res = errorResponse(new UnauthorizedError('no sesion'), reqWith());
    const body = await res.json();

    expect(body.correlationId).toBe(CORRELATION);
    expect(res.headers.get('x-correlation-id')).toBe(body.correlationId);
  });

  it('generates a correlation id when the request has none', async () => {
    const res = errorResponse(new UnauthorizedError('no sesion'), reqWith(null));
    const body = await res.json();

    expect(res.headers.get('x-correlation-id')).toBeTruthy();
    expect(body.correlationId).toBe(res.headers.get('x-correlation-id'));
  });

  it('never leaks the raw driver message for an unknown error', async () => {
    const res = errorResponse(new Error('connection to 10.0.0.5:5432 refused'), reqWith());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('internal_server_error');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });

  it('maps a forbidden error to 403', () => {
    const res = errorResponse(new ForbiddenError("Role 'viewer' cannot perform 'org.invite'"), reqWith());

    expect(res.status).toBe(403);
  });

  it('applies fallbackStatus when the error maps to internal_server_error', () => {
    const res = errorResponse(new Error('boom'), reqWith(), 502);

    expect(res.status).toBe(502);
  });

  it('ignores fallbackStatus when the error maps to a specific code', () => {
    const res = errorResponse(new AppErrorException('not_found', 'no existe'), reqWith(), 502);

    expect(res.status).toBe(404);
  });

  it('defaults internal_server_error to 500 when no fallback is given', () => {
    const res = errorResponse(new Error('boom'), reqWith());

    expect(res.status).toBe(500);
  });
});
