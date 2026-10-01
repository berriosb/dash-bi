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
export function redactError(error: unknown): RedactedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(error.message.replace(URL_PATTERN, URL_REDACTED)),
    };
  }
  if (typeof error === 'string') {
    return { name: 'Error', message: redactSecrets(error.replace(URL_PATTERN, URL_REDACTED)) };
  }
  return { name: 'Error', message: 'Unknown error' };
}