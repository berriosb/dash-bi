import type { Connector, Query, QueryResult } from '@/lib/connectors/types';
import { validateQuery } from '@/lib/security/validate-query';
import type { OrgRole } from '@/lib/auth/permissions';

export class QueryTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Query timed out after ${timeoutMs}ms`);
    this.name = 'QueryTimeoutError';
  }
}

const circuitBreakers = new Map<string, { failures: number; openedAt: number }>();

export function isCircuitOpen(connectorId: string): boolean {
  const state = circuitBreakers.get(connectorId);
  if (!state) return false;
  if (Date.now() - state.openedAt < 5 * 60 * 1000) return true; // 5 min cooldown
  circuitBreakers.delete(connectorId);
  return false;
}

export function recordFailure(connectorId: string): void {
  const state = circuitBreakers.get(connectorId) ?? { failures: 0, openedAt: 0 };
  state.failures += 1;
  if (state.failures >= 3) {
    state.openedAt = Date.now();
  }
  circuitBreakers.set(connectorId, state);
}

export function recordSuccess(connectorId: string): void {
  circuitBreakers.delete(connectorId);
}

export interface ExecuteOptions {
  timeoutMs?: number;
  retries?: number;
  /**
   * Sprint 1: rol del user ejecutando. Se pasa a validateQuery para
   * aplicar assertRolePermissions (PII masking para viewer).
   */
  role?: OrgRole;
  /**
   * Si true, valida la query con validateQuery() antes de ejecutar.
   * Default: true. Pasar false solo en paths internos de confianza
   * (ej: cuando la query ya fue validada por un caller superior).
   */
  validate?: boolean;
}

export async function executeWithTimeout(
  connector: Connector,
  connectorId: string,
  query: Query,
  opts: ExecuteOptions = {},
): Promise<QueryResult> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const retries = opts.retries ?? 1;
  const shouldValidate = opts.validate !== false;

  if (isCircuitOpen(connectorId)) {
    throw new QueryCircuitOpenError(connectorId);
  }

  // Sprint 1: validar ANTES de ejecutar (T2 SQL injection defense).
  //
  // `validateQuery` is pure: it returns the SQL with the LIMIT injected or
  // clamped and leaves `query` alone, so the statement that actually runs
  // is built here. Reusing the caller's object would skip the LIMIT
  // entirely now that nothing writes back.
  let effectiveQuery = query;
  if (shouldValidate) {
    const normalizedSql = validateQuery(query, connector.type, opts.role);
    if (normalizedSql !== undefined) {
      effectiveQuery = { ...query, sql: normalizedSql } as Query;
    }
  }

  const start = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    // One controller per attempt. On timeout it is aborted with the same
    // QueryTimeoutError the race rejects with, so a connector that honors
    // `signal` stops the work instead of leaving it running against the
    // customer's database after the caller already gave up. Without this
    // the connection stays pinned until Postgres/MySQL finishes a query
    // nobody is waiting for, which is how a few slow dashboards starve
    // the pool.
    const controller = new AbortController();
    try {
      const result = await Promise.race([
        connector.executeQuery(effectiveQuery, { signal: controller.signal, timeoutMs }),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => {
            const timeoutError = new QueryTimeoutError(timeoutMs);
            controller.abort(timeoutError);
            reject(timeoutError);
          }, timeoutMs);
        }),
      ]);

      recordSuccess(connectorId);
      return { ...result, executionTimeMs: Date.now() - start };
    } catch (error) {
      // A connector that honored the abort rejects with the same
      // QueryTimeoutError. Map anything else the abort surfaced back to the
      // timeout so the caller sees one error type, not a driver-specific
      // AbortError after the deadline already passed.
      if (controller.signal.aborted && !(error instanceof QueryTimeoutError)) {
        recordFailure(connectorId);
        throw controller.signal.reason;
      }
      if (attempt === retries || error instanceof QueryTimeoutError) {
        recordFailure(connectorId);
        throw error;
      }
    } finally {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    }
  }

  throw new Error('Unreachable query execution state');
}

export class QueryCircuitOpenError extends Error {
  constructor(public connectorId: string) {
    super(`Circuit breaker is OPEN for connector ${connectorId}`);
    this.name = 'QueryCircuitOpenError';
  }
}
