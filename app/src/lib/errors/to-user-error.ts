import { ZodError } from 'zod';
import { logger } from '@/lib/logger';
import { redactSecrets } from '@/lib/redact';
import { ValidationError } from '@/lib/security/validate-query';
import { QueryTimeoutError, QueryCircuitOpenError } from '@/lib/query-engine/execute';
import { DataSourceNotFoundError } from '@/lib/query-engine/resolve';
import {
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '@/lib/auth/context';
import {
  AppErrorException,
  ERROR_CATALOG,
  type AppError,
  type ErrorCode,
  type WidgetErrorState,
} from './types';

/**
 * Convierte cualquier error en un `AppError` shape consistente.
 *
 * Ver `errors-ux.md §4` para el contrato.
 *
 * Sprint 1 v0.2: helper central para API routes. Elimina la inconsistencia
 * de tener `toWidgetError`, `userMessage(error)`, etc. dispersos en cada spec.
 *
 * Uso:
 * ```ts
 * try {
 *   // ...
 * } catch (err) {
 *   const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();
 *   const appError = toUserError(err, correlationId);
 *   return Response.json(appError, { status: statusFromCode(appError.code) });
 * }
 * ```
 */
export function toUserError(err: unknown, correlationId: string): AppError {
  // 1. AppErrorException: ya viene tipado
  if (err instanceof AppErrorException) {
    return {
      code: err.code,
      message: err.message,
      correlationId,
      retryable: ERROR_CATALOG[err.code]?.retryable ?? false,
      details: err.details,
      fieldErrors: err.fieldErrors,
    };
  }

  // 2. ZodError → validation.invalid_format + fieldErrors
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || 'root';
      if (!fieldErrors[path]) {
        fieldErrors[path] = issue.message;
      }
    }
    return {
      code: 'validation.invalid_format',
      message: 'Revisá los campos marcados.',
      correlationId,
      retryable: false,
      fieldErrors,
    };
  }

  // 3. Custom errors from query-engine
  if (err instanceof QueryTimeoutError) {
    return makeError('query.timeout', correlationId, {
      timeoutMs: err.timeoutMs,
    });
  }
  if (err instanceof QueryCircuitOpenError) {
    return makeError('query.circuit_open', correlationId, {
      connectorId: err.connectorId,
    });
  }
  if (err instanceof DataSourceNotFoundError) {
    return makeError('connector.unreachable', correlationId, {
      dataSourceId: err.dataSourceId,
    });
  }

  // 4. ValidationError from validate-query.ts
  if (err instanceof ValidationError) {
    return makeError('query.forbidden_keyword', correlationId, {
      reason: err.message,
    });
  }

  // 5. Auth context errors
  if (err instanceof UnauthorizedError) {
    return makeError('auth.unauthorized', correlationId);
  }
  if (err instanceof ForbiddenError) {
    return makeError('auth.forbidden', correlationId);
  }
  if (err instanceof BadRequestError) {
    return makeError('validation.invalid_format', correlationId, {
      reason: err.message,
    });
  }

  // 6. Errores de negocio que viajan como `code` / `__code` en vez de una
  // clase propia. Sin esto, un `not_found` o un `alert.quota_exceeded`
  // terminado en cualquier capa caía al fallback y el cliente recibía un
  // 500 genérico, que es indistinguible de una caída real del servidor.
  const declaredCode = readDeclaredCode(err);
  if (declaredCode) {
    return makeError(declaredCode, correlationId);
  }

  // 7. Error genérico (incluye TypeError, fetch failures, etc.)
  // Logueamos con redaction para no filtrar secrets
  logger.error(
    { err: redactSecrets(String(err)), correlationId },
    'Unhandled error in API route',
  );

  return makeError('internal_server_error', correlationId);
}

/**
 * Alias de códigos de dominio → `ErrorCode` del catálogo.
 *
 * Los módulos de dominio nombran sus límites con su propio vocabulario
 * (`alert.quota_exceeded`, `CONCURRENCY_CONFLICT`, …). El catálogo es la
 * única fuente de verdad de status HTTP y copy user-facing, así que el
 * mapeo vive acá en vez de duplicarse en cada route.
 */
const CODE_ALIASES: Record<string, ErrorCode> = {
  'alert.quota_exceeded': 'tenant.quota_exceeded',
  'share.quota_exceeded': 'tenant.quota_exceeded',
  'export.quota_exceeded': 'tenant.quota_exceeded',
  'CONCURRENCY_CONFLICT': 'conflict',
  'concurrent_modification': 'conflict',
  'stale_write': 'conflict',
  'entity_not_found': 'not_found',
  'dashboard_not_found': 'not_found',
  'invalid_query': 'query.syntax_error',
};

/**
 * Lee un código de error declarativo desde un error desconocido y devuelve
 * el `ErrorCode` del catálogo, o `null` si no hay uno confiable.
 *
 * Se aceptan las tres convenciones que ya existen en el codebase:
 * `__code` (auth/context), `code` (módulos de dominio) y `name` para el
 * caso de errores que sólo se reconocen por su tipo nominal.
 */
function readDeclaredCode(err: unknown): ErrorCode | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as { __code?: unknown; code?: unknown; name?: unknown };

  const raw = [candidate.__code, candidate.code, candidate.name].find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (typeof raw !== 'string') return null;

  const aliased = CODE_ALIASES[raw];
  if (aliased) return aliased;
  if (raw in ERROR_CATALOG) return raw as ErrorCode;
  return null;
}

/**
 * Helper interno para construir AppError con defaults del catálogo.
 */
function makeError(
  code: ErrorCode,
  correlationId: string,
  details?: Record<string, unknown>,
): AppError {
  const catalogEntry = ERROR_CATALOG[code];
  return {
    code,
    message: catalogEntry?.defaultMessage ?? 'Error',
    correlationId,
    retryable: catalogEntry?.retryable ?? false,
    details,
  };
}

/**
 * Versión específica para widgets in-place en el dashboard.
 * Shape más liviano (sin fieldErrors) + callback de retry opcional.
 *
 * Ver `errors-ux.md §2.2`.
 */
export function toWidgetError(
  err: unknown,
  retryAction?: () => void,
  correlationId?: string,
): WidgetErrorState {
  const appError = toUserError(err, correlationId ?? generateCorrelationId());
  return {
    kind: appError.code,
    message: appError.message,
    retryable: appError.retryable,
    retryAction,
    correlationId: appError.correlationId,
  };
}

/**
 * Genera un correlationId único. Útil cuando no viene del header.
 */
export function generateCorrelationId(): string {
  return `req_${crypto.randomUUID()}`;
}

/**
 * Extrae correlationId del request, o genera uno nuevo.
 */
export function getOrGenerateCorrelationId(req: Request): string {
  return req.headers.get('x-correlation-id') ?? generateCorrelationId();
}