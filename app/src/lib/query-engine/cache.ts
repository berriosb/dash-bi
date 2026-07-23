import crypto from 'node:crypto';
import type { QueryResult } from '@/lib/connectors/types';

const memoryCache = new Map<string, { result: QueryResult; expiresAt: number }>();

export function generateCacheKey(orgId: string, dataSourceId: string, query: unknown): string {
  const queryStr = JSON.stringify(query, Object.keys(query as object).sort());
  const hash = crypto.createHash('sha256').update(queryStr).digest('hex');
  return `query:${orgId}:${dataSourceId}:${hash}`;
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
