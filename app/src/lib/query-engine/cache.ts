import crypto from 'node:crypto';
import type { QueryResult } from '@/lib/connectors/types';
import type { OrgRole } from '@/lib/auth/permissions';

const memoryCache = new Map<string, { result: QueryResult; expiresAt: number }>();

/**
 * A plain object is one whose prototype is `Object.prototype` (or `null`).
 *
 * Everything else — a `Date`, a class instance — is left untouched so that
 * `JSON.stringify` keeps doing what it knows how to do (`toJSON`, ISO
 * dates, and the cycle detection that turns a circular query into an
 * error instead of a hang).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The canonical form of a query: the keys of every object sorted, at every
 * level.
 *
 * The previous implementation used `JSON.stringify(query, Object.keys(query).sort())`
 * — a replacer ARRAY, and a replacer array is applied at EVERY level of the
 * value, not just the top one. So any object nested below the top level was
 * filtered by the TOP-LEVEL key list and came out EMPTY:
 *
 *   { kind: 'stripe', params: { limit: 10 }  } → {"kind":"stripe","params":{}}
 *   { kind: 'stripe', params: { limit: 999 } } → {"kind":"stripe","params":{}}
 *
 * Two different questions, one key, one cached answer: the second user got
 * the first user's rows. The GA4 connector was the worst case — its
 * `dateRange` is always nested, so EVERY period collapsed into the same key
 * and the dashboard rendered whichever period happened to be cached first.
 *
 * Sorting the keys at every level keeps the one property that made the
 * original work (the key does not depend on the order the keys were
 * written in) and drops the one that broke it.
 *
 * The order of an ARRAY is preserved on purpose: in a SQL query the array
 * is the binding order, so `[1, 2]` and `[2, 1]` are different questions.
 */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const nested = value[key];
    // `JSON.stringify` drops `undefined` properties; doing it here keeps
    // the two behaviours identical.
    if (nested === undefined) continue;
    out[key] = canonicalJson(nested);
  }
  return out;
}

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
  const queryStr = JSON.stringify(canonicalJson(query) ?? null);
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
