import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { redactSecrets } from './redact';

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

const baseOptions: pino.LoggerOptions = {
  level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
  redact,
  base: {
    env: process.env.NODE_ENV,
    service: 'dash-bi',
    version: process.env.npm_package_version || '0.1.0',
  },
  // Custom formatter para redactar strings completos que matchean patterns
  formatters: {
    log(obj) {
      // Redactar cualquier string que parezca API key
      const redacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        redacted[key] = typeof value === 'string' ? redactSecrets(value) : value;
      }
      return redacted;
    },
  },
};

export const logger = pino(
  baseOptions,
  isDev && !isTest
    ? pinoPretty({
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname,env,service,version',
      })
    : undefined,
);

// Logger para contexto (request-scoped)
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}