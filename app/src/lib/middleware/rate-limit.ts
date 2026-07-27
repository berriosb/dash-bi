import { NextResponse } from 'next/server';
import { checkRateLimit, type RateLimitConfig } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export interface RateLimitOptions {
  capacity: number;
  refillPerSecond: number;
  keyPrefix: string;
}

export type RouteContext<Args extends unknown[] = unknown[]> = (
  ...args: Args
) => Promise<Response> | Response;

export function withRateLimit<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
  options: RateLimitOptions,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    const req = args[0] as Request | undefined;
    const ip = req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const config: RateLimitConfig = {
      capacity: options.capacity,
      refillPerSecond: options.refillPerSecond,
      key: `${options.keyPrefix}:ip:${ip}`,
    };

    const result = checkRateLimit(config);
    if (!result.allowed) {
      logger.warn(
        { key: config.key, retryAfter: result.retryAfterSeconds },
        'Rate limit exceeded',
      );
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds },
        {
          status: 429,
          headers: {
            'Retry-After': String(result.retryAfterSeconds),
            'X-RateLimit-Limit': String(options.capacity),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }

    return handler(...args);
  };
}

export function rateLimitByOrgAndIp(
  options: Omit<RateLimitOptions, 'keyPrefix'> & { keyPrefix?: string },
): (orgId: string | null | undefined, ip: string) => ReturnType<typeof checkRateLimit> {
  return (orgId, ip) =>
    checkRateLimit({
      capacity: options.capacity,
      refillPerSecond: options.refillPerSecond,
      key: `${options.keyPrefix ?? 'rl'}:org:${orgId ?? 'anon'}:ip:${ip}`,
    });
}