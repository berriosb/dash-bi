import type { Connector, Query, QueryResult } from '@/lib/connectors/types';

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

export async function executeWithTimeout(
  connector: Connector,
  connectorId: string,
  query: Query,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<QueryResult> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const retries = opts.retries ?? 1;

  if (isCircuitOpen(connectorId)) {
    throw new Error(`Circuit breaker is OPEN for connector ${connectorId}`);
  }

  const start = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await Promise.race([
        connector.executeQuery(query),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new QueryTimeoutError(timeoutMs)), timeoutMs),
        ),
      ]);

      recordSuccess(connectorId);
      return { ...result, executionTimeMs: Date.now() - start };
    } catch (error) {
      if (attempt === retries) {
        recordFailure(connectorId);
        throw error;
      }
    }
  }

  throw new Error('Unreachable query execution state');
}
