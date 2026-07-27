// In-memory rate limiter (token bucket).
//
// Casos de uso MVP: AI generate, connector test, data source create.
// En Sprint 5+ se migra a Redis-backed para multi-instancia.

interface BucketState {
  tokens: number;
  lastRefillAt: number;
}

export interface RateLimitConfig {
  /** Max tokens in the bucket (= max requests in burst) */
  capacity: number;
  /** Tokens added per second (= average rate) */
  refillPerSecond: number;
  /** Identifier for this bucket (e.g. `org:abc:ip:1.2.3.4`) */
  key: string;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remainingTokens: number;
}

const buckets = new Map<string, BucketState>();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, state] of buckets.entries()) {
    if (now - state.lastRefillAt > 60 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();

export function checkRateLimit(config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(config.key);

  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefillAt: now };
    buckets.set(config.key, bucket);
  }

  const elapsedSeconds = (now - bucket.lastRefillAt) / 1000;
  const refilled = elapsedSeconds * config.refillPerSecond;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + refilled);
  bucket.lastRefillAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remainingTokens: Math.floor(bucket.tokens),
    };
  }

  // No tokens available — how long until 1 is refilled?
  const deficit = 1 - bucket.tokens;
  const retryAfterSeconds = deficit / config.refillPerSecond;
  return {
    allowed: false,
    retryAfterSeconds: Math.ceil(retryAfterSeconds),
    remainingTokens: 0,
  };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

export function resetAllRateLimits(): void {
  buckets.clear();
}