import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically random URL-safe token for public share links.
 *
 * Spec `export.md §5.2`: 24 bytes = 192 bits of entropy → 32 chars in base64url.
 * Brute-force resistant (2^192 combinations).
 */
export function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}