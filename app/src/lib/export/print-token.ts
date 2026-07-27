import { Redis } from 'ioredis';
import { randomBytes } from 'crypto';
import { logger } from '@/lib/logger';

const PRINT_TOKEN_TTL_SECONDS = 30 * 60;
const PRINT_TOKEN_PREFIX = 'print:';

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  }
  return redis;
}

export type PrintTokenPayload = {
  dashboardId: string;
  orgId: string;
};

/**
 * Generate a one-time print token for the dashboard/[id]/print route.
 *
 * Tokens are stored in Redis with a 30-minute TTL. The token itself is
 * included in the print URL the worker opens; validatePrintToken() then
 * deletes the key (single-use).
 */
export async function generatePrintToken(
  dashboardId: string,
  orgId: string
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const payload: PrintTokenPayload = { dashboardId, orgId };
  await getRedis().set(
    `${PRINT_TOKEN_PREFIX}${token}`,
    JSON.stringify(payload),
    'EX',
    PRINT_TOKEN_TTL_SECONDS
  );
  return token;
}

/**
 * Validate and consume a one-time print token.
 *
 * Returns the payload if the token exists, otherwise null. The token is
 * deleted on successful validation (single-use).
 */
export async function validatePrintToken(token: string): Promise<PrintTokenPayload | null> {
  const key = `${PRINT_TOKEN_PREFIX}${token}`;
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as PrintTokenPayload;
    if (typeof payload.dashboardId !== 'string' || typeof payload.orgId !== 'string') {
      return null;
    }
    await getRedis().del(key);
    return payload;
  } catch (error) {
    logger.error({ err: error, token }, 'print-token: malformed JSON in Redis');
    return null;
  }
}