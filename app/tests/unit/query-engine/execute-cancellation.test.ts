import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeWithTimeout, QueryTimeoutError } from '@/lib/query-engine/execute';
import { throwIfAborted } from '@/lib/connectors/types';
import type { Connector } from '@/lib/connectors/types';

/**
 * `executeWithTimeout` used to race the connector promise against a timer.
 * When the timer won, the caller got a `QueryTimeoutError` and the query
 * kept running against the customer's database — connection pinned, work
 * paid for, nobody waiting. The connector contract now carries an
 * `AbortSignal` that the timeout aborts with the same error.
 */
describe('executeWithTimeout — cancels the underlying query on timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the signal with the timeout error so the connector can stop', async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    let abortedWith: unknown;

    const connector: Connector = {
      type: 'postgres',
      testConnection: async () => ({ ok: true, latencyMs: 1 }),
      getSchema: async () => ({ tables: [] }),
      executeQuery: vi.fn((_query, opts) =>
        new Promise<never>((_resolve, reject) => {
          capturedSignal = opts?.signal;
          opts?.signal?.addEventListener('abort', () => {
            abortedWith = opts?.signal?.reason;
            reject(opts?.signal?.reason as Error);
          });
        }),
      ),
    };

    const pending = executeWithTimeout(
      connector,
      'ds-1',
      { kind: 'sql', sql: 'SELECT * FROM slow_table' },
      { timeoutMs: 1000 },
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(QueryTimeoutError);

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
    expect(abortedWith).toBeInstanceOf(QueryTimeoutError);
  });

  it('does not abort when the connector resolves first', async () => {
    const captured: { signal?: AbortSignal } = {};

    const connector: Connector = {
      type: 'postgres',
      testConnection: async () => ({ ok: true, latencyMs: 1 }),
      getSchema: async () => ({ tables: [] }),
      executeQuery: vi.fn(async (_query, opts) => {
        captured.signal = opts?.signal;
        return { rows: [], rowCount: 0, executionTimeMs: 1 };
      }),
    };

    await executeWithTimeout(connector, 'ds-2', { kind: 'sql', sql: 'SELECT 1' });

    expect(captured.signal?.aborted).toBe(false);
  });

  it('surfaces a driver AbortError as the timeout error, not a foreign error', async () => {
    vi.useFakeTimers();

    const connector: Connector = {
      type: 'postgres',
      testConnection: async () => ({ ok: true, latencyMs: 1 }),
      getSchema: async () => ({ tables: [] }),
      executeQuery: vi.fn((_query, opts) =>
        new Promise<never>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () =>
            // Simulates a driver that wraps the abort in its own error.
            reject(Object.assign(new Error('socket hang up'), { name: 'AbortError' })),
          );
        }),
      ),
    };

    const pending = executeWithTimeout(
      connector,
      'ds-3',
      { kind: 'sql', sql: 'SELECT 1' },
      { timeoutMs: 500 },
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(QueryTimeoutError);

    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});

describe('throwIfAborted', () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  it('is a no-op for an un-aborted signal', () => {
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it('throws the abort reason once aborted', () => {
    const reason = new Error('deadline');
    controller.abort(reason);

    expect(() => throwIfAborted(controller.signal)).toThrow(reason);
  });
});