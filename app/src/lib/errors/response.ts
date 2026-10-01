import { NextResponse } from 'next/server';
import { getOrGenerateCorrelationId, toUserError } from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

/**
 * Build the canonical error `Response` for a route handler.
 *
 * Every route handler should return this instead of hand-rolling the
 * `toUserError` + `statusFromCode` + `x-correlation-id` integration, so the
 * API has exactly ONE error contract. See `docs/security/threat-model.md`.
 *
 * @param error        The thrown value. Unknown errors map to a sanitized
 *                     `internal_server_error`; raw messages are never leaked.
 * @param req          The incoming request, used to read or generate the
 *                     correlation id.
 * @param fallbackStatus  Status to use when the error maps to
 *                     `internal_server_error`. Defaults to 500. Ignored for
 *                     any error that maps to a specific code.
 */
export function errorResponse(error: unknown, req: Request, fallbackStatus = 500): NextResponse {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  const status =
    appError.code === 'internal_server_error' ? fallbackStatus : statusFromCode(appError.code);

  return NextResponse.json(appError, {
    status,
    headers: { 'x-correlation-id': correlationId },
  });
}
