import { describe, it, expect } from 'vitest';
import { generatePublicToken } from '@/lib/sharing/token';

describe('generatePublicToken', () => {
  it('returns a string with at least 32 characters (brute-force resistant)', () => {
    const token = generatePublicToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it('returns URL-safe characters only (base64url alphabet)', () => {
    const token = generatePublicToken();
    // base64url = A-Z, a-z, 0-9, '-', '_'
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a unique token on each call (no collisions in 1000 samples)', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(generatePublicToken());
    }
    expect(tokens.size).toBe(1000);
  });
});