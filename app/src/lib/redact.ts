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