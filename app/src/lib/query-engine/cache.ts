import crypto from 'node:crypto';
import type { QueryResult } from '@/lib/connectors/types';
import type { OrgRole } from '@/lib/auth/permissions';

const memoryCache = new Map<string, { result: QueryResult; expiresAt: number }>();

/**
 * `role` is REQUIRED, not optional, and it is part of the key.
 *
 * The cache is populated on the miss path, which is the only path where
 * `validateQuery` runs. Without the role in the key, a result that an admin
 * was allowed to read was served straight from the cache to a viewer, and the
 * PII filter never ran for them. Making the parameter required turns "forgot
 * to pass the role" into a type error instead of a silent cross-role leak.
 */
export function generateCacheKey(
  orgId: string,
  dataSourceId: string,
  query: unknown,
  role: OrgRole,
): string {
  const queryStr = JSON.stringify(query, Object.keys(query as object).sort());
  const hash = crypto.createHash('sha256').update(queryStr).digest('hex');
  return `query:${orgId}:${dataSourceId}:${role}:${hash}`;
}

export async function cacheGet(key: string): Promise<QueryResult | null> {
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return entry.result;
}

export async function cacheSet(
  key: string,
  result: QueryResult,
  ttlSeconds = 60,
): Promise<void> {
  memoryCache.set(key, {
    result,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export function cacheClearOrg(orgId: string): void {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(`query:${orgId}:`)) {
      memoryCache.delete(key);
    }
  }
}
