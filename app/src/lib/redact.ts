// T4 del threat model: redactar API keys y otros secrets de strings
// Aplicado en logger + cualquier output que pueda llegar a logs/errors

const API_KEY_PATTERNS: RegExp[] = [
  // OpenAI
  /\bsk-[a-zA-Z0-9]{20,}\b/g,
  // Anthropic
  /\bsk-ant-[a-zA-Z0-9-]{20,}\b/g,
  // Google
  /\bAIza[a-zA-Z0-9_-]{35}\b/g,
  // Stripe
  /\bsk_(?:live|test)_[a-zA-Z0-9]{20,}\b/g,
  /\brk_(?:live|test)_[a-zA-Z0-9]{20,}\b/g,
  // AWS
  /\bAKIA[A-Z0-9]{16}\b/g,
  // Bearer tokens (general)
  /\bBearer\s+[a-zA-Z0-9-_.]{20,}\b/g,
  // JWT (basic)
  /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  // Generic long random strings (40+ chars alfanuméricos)
  // OJO: agresivo, puede causar false positives
  /\b[a-zA-Z0-9_-]{40,}\b/g,
];

const REDACTED = '[REDACTED]';

export function redactSecrets(input: string): string {
  if (!input || typeof input !== 'string') return input;
  
  let result = input;
  for (const pattern of API_KEY_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export function redactObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = redactSecrets(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

// ── Errores (T5) ────────────────────────────────────────────────────────────

// Matches an absolute http(s) URL, including its query string. A magic-link,
// reset-password or verify-email URL carries its single-use token in the query
// string, and those flows are exactly where an email provider failure gets
// logged. `redactSecrets` does not cover this: its generic pattern needs 40+
// characters, while a better-auth verification token is shorter than that.
const URL_PATTERN = /\bhttps?:\/\/[^\s'"<>)]+/gi;

const URL_REDACTED = '[URL_REDACTED]';

/**
 * Credentials embedded in a connection string:
 * `postgresql://dashbi:s3cr3t@db.internal:5432/dashbi`.
 *
 * `redactSecrets` scrubs API keys, not URL credentials: the generic
 * 40+ character pattern does not match a short password, and the password
 * is the part that matters. A driver error message routinely carries the
 * whole DSN, so this runs before anything is logged.
 */
const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@]+):[^@\s/]+@/g;

/**
 * Replace the password of every connection string in a string.
 */
export function scrubUrlCredentials(input: string): string {
  if (!input || typeof input !== 'string') return input;
  return input.replace(URL_CREDENTIALS, '$1:[REDACTED]@');
}

/** The loggable shape of an error: a name and a scrubbed message, nothing else. */
export interface RedactedError {
  name: string;
  message: string;
}

/**
 * Reduce an unknown thrown value to a loggable `{ name, message }`.
 *
 * Intentionally lossy. The alternative — logging the error object — is what
 * T5 flagged: `console.error('sendMagicLink failed:', error)` prints the whole
 * object, stack included, on the one code path that handles a token URL.
 * Routing that through Pino is not enough on its own, because
 * `logger.redact.paths` matches FIELD NAMES and a token inside a MESSAGE
 * matches none of them.
 *
 * `cause` is dropped, not summarised. A provider that fails mid-request
 * commonly attaches the offending payload as the cause, and a redacted
 * summary of it still leaks the shape of what was sent.
 */
/**
 * Scrub a string for the log: URLs (they carry single-use tokens),
 * connection-string credentials, then secret-shaped values.
 */
export function scrubLogText(input: string): string {
  return redactSecrets(scrubUrlCredentials(input.replace(URL_PATTERN, URL_REDACTED)));
}

export function redactError(error: unknown): RedactedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: scrubLogText(error.message),
    };
  }
  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: scrubLogText(error),
    };
  }
  return { name: 'Error', message: 'Unknown error' };
}

/**
 * The loggable shape of an error for the LOGGER: the type, the scrubbed
 * message and the scrubbed stack.
 *
 * The stack is kept (scrubbed) on purpose: the stack repeats the message,
 * so it has to be scrubbed too, but dropping it would make production
 * debugging impossible. Pino's own `stdSerializers.err` writes the message
 * and the stack in clear, which is what T5 flagged.
 */
export function redactLogError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: scrubLogText(error.message),
      stack: typeof error.stack === 'string' ? scrubLogText(error.stack) : undefined,
    };
  }
  return error;
}

/**
 * Recursively scrub a value for the log.
 *
 * Strings are scrubbed, Errors become their scrubbed loggable shape, and
 * arrays and plain objects are walked. Objects that are NOT plain (a
 * Date, a Buffer, a class instance) are left alone: walking them would
 * destroy their shape for no gain, and pino has its own serializers for
 * the common ones.
 */
export function redactLogValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubLogText(value);
  if (value instanceof Error) return redactLogError(value);
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return redactLogObject(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Recursively scrub a log object.
 *
 * This is what the logger's formatter runs on every line: the old one only
 * looked at TOP-LEVEL strings, so `logger.error({ err })` wrote the error's
 * message and stack in clear.
 */
export function redactLogObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = redactLogValue(value);
  }
  return result as T;
}