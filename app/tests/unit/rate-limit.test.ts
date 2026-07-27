import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimit, resetAllRateLimits } from '@/lib/rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  it('allows requests up to capacity', () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit({ capacity: 5, refillPerSecond: 0, key: 'k1' });
      expect(r.allowed).toBe(true);
    }
  });

  it('rejects requests beyond capacity', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ capacity: 5, refillPerSecond: 0, key: 'k2' });
    }
    const r = checkRateLimit({ capacity: 5, refillPerSecond: 0, key: 'k2' });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('uses separate buckets per key', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ capacity: 5, refillPerSecond: 0, key: 'org-a' });
    }
    expect(checkRateLimit({ capacity: 5, refillPerSecond: 0, key: 'org-a' }).allowed).toBe(false);
    expect(checkRateLimit({ capacity: 5, refillPerSecond: 0, key: 'org-b' }).allowed).toBe(true);
  });

  it('refills tokens over time', async () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ capacity: 3, refillPerSecond: 0, key: 'refill' });
    }
    expect(checkRateLimit({ capacity: 3, refillPerSecond: 0, key: 'refill' }).allowed).toBe(false);

    // Reset to test refill — refill at 10/sec for 200ms = ~2 tokens
    resetRateLimit('refill');
    checkRateLimit({ capacity: 3, refillPerSecond: 10, key: 'refill' });
    checkRateLimit({ capacity: 3, refillPerSecond: 10, key: 'refill' });
    checkRateLimit({ capacity: 3, refillPerSecond: 10, key: 'refill' });
    expect(checkRateLimit({ capacity: 3, refillPerSecond: 10, key: 'refill' }).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 250));
    const r = checkRateLimit({ capacity: 3, refillPerSecond: 10, key: 'refill' });
    expect(r.allowed).toBe(true);
  });

  it('resetRateLimit clears specific bucket', () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ capacity: 3, refillPerSecond: 0, key: 'target' });
    }
    expect(checkRateLimit({ capacity: 3, refillPerSecond: 0, key: 'target' }).allowed).toBe(false);

    resetRateLimit('target');
    expect(checkRateLimit({ capacity: 3, refillPerSecond: 0, key: 'target' }).allowed).toBe(true);
  });
});