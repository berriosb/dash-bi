import pino, { type Logger } from 'pino';
import pinoPretty from 'pino-pretty';
import { redactLogError, redactLogObject } from './redact';

// Logger estructurado con redacción automática de secrets
// Cumple T4 del threat model: API keys nunca en logs

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

const redact = {
  // API key patterns
  paths: [
    'llmApiKeyEncrypted',
    'llmApiKey',
    'apiKey',
    'api_key',
    'password',
    'connectionString',
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'LLM_KEY_ENCRYPTION_KEY',
    'RESEND_API_KEY',
    'PDF_WORKER_SECRET',
    'GOOGLE_CLIENT_SECRET',
  ],
  censor: '[REDACTED]',
};

/**
 * The formatter pino runs on every line.
 *
 * The old one only redacted TOP-LEVEL strings, so `logger.error({ err })`
 * wrote the error's message AND stack in clear: a driver error routinely
 * carries a DSN with a password, and an SDK error carries an API key.
 *
 * Now every value is walked: strings are scrubbed, errors become their
 * scrubbed shape (message and stack), and nested objects and arrays are
 * walked too.
 */
export function formatLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  return redactLogObject(obj);
}

/**
 * The options the logger is built with.
 *
 * Exported so the tests can build a logger with the SAME options over a
 * capturable destination: the point of the test is the behavior of the
 * real configuration, not of a copy of it.
 */
export function buildLoggerOptions(): pino.LoggerOptions {
  return {
    level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
    redact,
    base: {
      env: process.env.NODE_ENV,
      service: 'dash-bi',
      version: process.env.npm_package_version || '0.1.0',
    },
    formatters: {
      log: formatLogObject,
    },
    serializers: {
      // Pino's own `stdSerializers.err` writes the message and the stack in
      // clear, and it only covers the `err` key: `logger.error({ error })`
      // was serialized to `{}` (the diagnostics lost) or leaked. These
      // replace it for both keys.
      err: redactLogError,
      error: redactLogError,
    },
  };
}

export const logger = pino(
  buildLoggerOptions(),
  isDev && !isTest
    ? pinoPretty({
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname,env,service,version',
      })
    : undefined,
);

// Logger para contexto (request-scoped)
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

/**
 * Sprint 1 v0.2: helper para request-scoped logging.
 *
 * Extrae o genera un correlationId del request y crea un child logger
 * con bindings para orgId/userId (si están disponibles).
 *
 * Ver `errors-ux.md §7` para el contrato de correlation IDs.
 *
 * Uso en API routes:
 * ```ts
 * const { correlationId, logger: reqLogger } = logRequest(req);
 * reqLogger.info('dashboard.generate started');
 * // ...
 * return Response.json(result, {
 *   headers: { 'x-correlation-id': correlationId },
 * });
 * ```
 */
export interface RequestLogContext {
  correlationId: string;
  logger: Logger;
}

export function logRequest(req: Request): RequestLogContext {
  const correlationId = req.headers.get('x-correlation-id') ?? generateCorrelationId();
  const url = new URL(req.url);
  const bindings: Record<string, unknown> = {
    correlationId,
    method: req.method,
    path: url.pathname,
  };
  return {
    correlationId,
    logger: logger.child(bindings),
  };
}

/**
 * Genera un correlation ID único con prefijo `req_`.
 */
export function generateCorrelationId(): string {
  return `req_${crypto.randomUUID()}`;
}
