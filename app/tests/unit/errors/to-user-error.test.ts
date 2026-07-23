import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { z } from 'zod';
import {
  AppErrorException,
  ERROR_CATALOG,
  statusFromCode,
  type ErrorCode,
} from '@/lib/errors/types';
import {
  toUserError,
  toWidgetError,
  generateCorrelationId,
  getOrGenerateCorrelationId,
} from '@/lib/errors/to-user-error';
import { ValidationError } from '@/lib/security/validate-query';
import { QueryTimeoutError, QueryCircuitOpenError } from '@/lib/query-engine/execute';
import { DataSourceNotFoundError } from '@/lib/query-engine/resolve';
import {
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '@/lib/auth/context';

const CORRELATION = 'req_test-1234';

describe('toUserError — error catalog mapping', () => {
  describe('AppErrorException', () => {
    it('passes through code + message from AppErrorException', () => {
      const err = new AppErrorException('auth.invalid_credentials', 'Email malformado');
      const result = toUserError(err, CORRELATION);

      expect(result.code).toBe('auth.invalid_credentials');
      expect(result.message).toBe('Email malformado');
      expect(result.correlationId).toBe(CORRELATION);
      expect(result.retryable).toBe(false);
    });

    it('uses defaultMessage when AppErrorException has no message', () => {
      const err = new AppErrorException('auth.forbidden');
      const result = toUserError(err, CORRELATION);

      expect(result.message).toBe(ERROR_CATALOG['auth.forbidden'].defaultMessage);
    });

    it('includes details and fieldErrors from AppErrorException', () => {
      const err = new AppErrorException(
        'validation.invalid_format',
        'Bad input',
        { extra: 'data' },
        { email: 'invalid' },
      );
      const result = toUserError(err, CORRELATION);

      expect(result.details).toEqual({ extra: 'data' });
      expect(result.fieldErrors).toEqual({ email: 'invalid' });
    });
  });

  describe('ZodError → validation.invalid_format', () => {
    it('maps ZodError to validation.invalid_format with fieldErrors', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(0),
      });
      let zodErr: ZodError | undefined;
      try {
        schema.parse({ email: 'not-an-email', age: -5 });
      } catch (e) {
        zodErr = e as ZodError;
      }

      const result = toUserError(zodErr!, CORRELATION);
      expect(result.code).toBe('validation.invalid_format');
      expect(result.retryable).toBe(false);
      expect(result.fieldErrors).toBeDefined();
      expect(Object.keys(result.fieldErrors!).length).toBeGreaterThan(0);
    });

    it('handles nested ZodError paths', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        }),
      });
      let zodErr: ZodError | undefined;
      try {
        schema.parse({ user: { profile: { email: 'bad' } } });
      } catch (e) {
        zodErr = e as ZodError;
      }

      const result = toUserError(zodErr!, CORRELATION);
      expect(result.fieldErrors!['user.profile.email']).toBeDefined();
    });
  });

  describe('Query engine errors', () => {
    it('QueryTimeoutError → query.timeout', () => {
      const result = toUserError(new QueryTimeoutError(30000), CORRELATION);
      expect(result.code).toBe('query.timeout');
      expect(result.retryable).toBe(true);
      expect(result.details).toMatchObject({ timeoutMs: 30000 });
    });

    it('QueryCircuitOpenError → query.circuit_open', () => {
      const result = toUserError(new QueryCircuitOpenError('ds-123'), CORRELATION);
      expect(result.code).toBe('query.circuit_open');
      expect(result.retryable).toBe(true);
      expect(result.details).toMatchObject({ connectorId: 'ds-123' });
    });

    it('DataSourceNotFoundError → connector.unreachable', () => {
      const result = toUserError(new DataSourceNotFoundError('ds-xyz'), CORRELATION);
      expect(result.code).toBe('connector.unreachable');
      expect(result.retryable).toBe(true);
    });
  });

  describe('Validation errors', () => {
    it('ValidationError from validate-query → query.forbidden_keyword', () => {
      const result = toUserError(new ValidationError('DROP not allowed'), CORRELATION);
      expect(result.code).toBe('query.forbidden_keyword');
      expect(result.retryable).toBe(false);
    });
  });

  describe('Auth context errors', () => {
    it('UnauthorizedError → auth.unauthorized', () => {
      const result = toUserError(new UnauthorizedError(), CORRELATION);
      expect(result.code).toBe('auth.unauthorized');
    });

    it('ForbiddenError → auth.forbidden', () => {
      const result = toUserError(new ForbiddenError('not admin'), CORRELATION);
      expect(result.code).toBe('auth.forbidden');
    });

    it('BadRequestError → validation.invalid_format', () => {
      const result = toUserError(new BadRequestError('missing field'), CORRELATION);
      expect(result.code).toBe('validation.invalid_format');
    });
  });

  describe('Generic errors → internal_server_error', () => {
    it('plain Error → internal_server_error', () => {
      const result = toUserError(new Error('something broke'), CORRELATION);
      expect(result.code).toBe('internal_server_error');
      expect(result.retryable).toBe(true);
      expect(result.correlationId).toBe(CORRELATION);
    });

    it('string error → internal_server_error', () => {
      const result = toUserError('just a string', CORRELATION);
      expect(result.code).toBe('internal_server_error');
    });

    it('null error → internal_server_error', () => {
      const result = toUserError(null, CORRELATION);
      expect(result.code).toBe('internal_server_error');
    });

    it('undefined error → internal_server_error', () => {
      const result = toUserError(undefined, CORRELATION);
      expect(result.code).toBe('internal_server_error');
    });
  });

  describe('correlationId propagation', () => {
    it('uses provided correlationId', () => {
      const result = toUserError(new Error('x'), 'req_custom-id-9999');
      expect(result.correlationId).toBe('req_custom-id-9999');
    });
  });
});

describe('toWidgetError — widget error state mapping', () => {
  it('returns WidgetErrorState shape', () => {
    const retry = () => undefined;
    const result = toWidgetError(new Error('x'), retry, CORRELATION);

    expect(result.kind).toBe('internal_server_error');
    expect(result.message).toBeDefined();
    expect(result.retryable).toBe(true);
    expect(result.retryAction).toBe(retry);
    expect(result.correlationId).toBe(CORRELATION);
  });

  it('generates correlationId when not provided', () => {
    const result = toWidgetError(new Error('x'));
    expect(result.correlationId).toMatch(/^req_/);
  });
});

describe('generateCorrelationId / getOrGenerateCorrelationId', () => {
  it('generateCorrelationId returns req_-prefixed UUID', () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^req_[0-9a-f-]{36}$/);
  });

  it('generates unique IDs', () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    expect(a).not.toBe(b);
  });

  it('getOrGenerateCorrelationId returns existing header', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-correlation-id': 'req_existing-id' },
    });
    expect(getOrGenerateCorrelationId(req)).toBe('req_existing-id');
  });

  it('getOrGenerateCorrelationId generates when header missing', () => {
    const req = new Request('http://localhost');
    const id = getOrGenerateCorrelationId(req);
    expect(id).toMatch(/^req_/);
  });
});

describe('ERROR_CATALOG integrity', () => {
  it('every ErrorCode has a catalog entry', () => {
    const codes: ErrorCode[] = [
      'auth.unauthorized', 'auth.forbidden', 'auth.session_expired',
      'auth.email_not_verified', 'auth.rate_limited', 'auth.invalid_credentials',
      'tenant.not_member', 'tenant.cross_tenant_access', 'tenant.quota_exceeded',
      'validation.required', 'validation.invalid_format', 'validation.too_long',
      'validation.too_short', 'validation.out_of_range',
      'connector.unreachable', 'connector.timeout', 'connector.invalid_credentials',
      'connector.ssrf_blocked', 'connector.rate_limited', 'connector.unsupported_format',
      'connector.file_too_large', 'connector.row_limit_exceeded',
      'query.timeout', 'query.forbidden_keyword', 'query.forbidden_table',
      'query.syntax_error', 'query.execution_error', 'query.circuit_open',
      'llm.provider_down', 'llm.rate_limited', 'llm.invalid_api_key',
      'llm.budget_exceeded', 'llm.json_parse_failed', 'llm.max_retries_exceeded',
      'export.timeout', 'export.render_failed', 'export.file_too_large', 'export.queue_full',
      'share.not_found', 'share.expired', 'share.revoked',
      'internal_server_error', 'not_found', 'method_not_allowed', 'payload_too_large',
    ];
    for (const code of codes) {
      expect(ERROR_CATALOG[code]).toBeDefined();
      expect(ERROR_CATALOG[code].httpStatus).toBeGreaterThanOrEqual(400);
      expect(ERROR_CATALOG[code].httpStatus).toBeLessThan(600);
      expect(typeof ERROR_CATALOG[code].retryable).toBe('boolean');
      expect(ERROR_CATALOG[code].defaultMessage.length).toBeGreaterThan(0);
    }
  });

  it('retryable flags match expectations', () => {
    expect(ERROR_CATALOG['query.timeout'].retryable).toBe(true);
    expect(ERROR_CATALOG['query.forbidden_keyword'].retryable).toBe(false);
    expect(ERROR_CATALOG['llm.budget_exceeded'].retryable).toBe(false);
    expect(ERROR_CATALOG['auth.invalid_credentials'].retryable).toBe(false);
    expect(ERROR_CATALOG['connector.unreachable'].retryable).toBe(true);
  });
});

describe('statusFromCode', () => {
  it('returns the right HTTP status for known codes', () => {
    expect(statusFromCode('auth.unauthorized')).toBe(401);
    expect(statusFromCode('auth.forbidden')).toBe(403);
    expect(statusFromCode('validation.invalid_format')).toBe(400);
    expect(statusFromCode('query.timeout')).toBe(504);
    expect(statusFromCode('share.not_found')).toBe(404);
    expect(statusFromCode('internal_server_error')).toBe(500);
  });

  it('returns 500 for unknown code', () => {
    expect(statusFromCode('nonexistent.code' as ErrorCode)).toBe(500);
  });
});