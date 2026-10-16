import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateQuery } from '@/lib/security/validate-query';
import { executeWithTimeout } from '@/lib/query-engine/execute';
import type { Connector, Query } from '@/lib/connectors/types';

/**
 * `validateQuery` used to rewrite `query.sql` in place to inject the
 * LIMIT. Every caller therefore depended on a hidden side effect: a
 * validator that mutates its argument is not safe to run twice on a shared
 * object, and a caller that keys a cache on `query.sql` before validating
 * ends up with a key that does not describe what ran.
 */
describe('validateQuery — purity', () => {
  it('does not mutate the query it is given', () => {
    const query: Query = {
      kind: 'sql',
      sql: 'SELECT * FROM orders',
      params: [],
    };

    const normalized = validateQuery(query, 'postgres');

    expect(normalized).toBe('SELECT * FROM orders LIMIT 10000');
    // The caller's object is untouched.
    expect(query.sql).toBe('SELECT * FROM orders');
  });

  it('is idempotent: a second call on an already-normalized string is stable', () => {
    const first = validateQuery({ kind: 'sql', sql: 'SELECT 1' }, 'postgres');
    const second = validateQuery({ kind: 'sql', sql: first! }, 'postgres');

    expect(second).toBe(first);
  });

  it('leaves a rejected query untouched too', () => {
    // A spreadsheet-kind query is rejected by the postgres dialect; the
    // point is that rejecting it does not rewrite the caller's object
    // either. SpreadsheetConnector re-projects the query as kind 'sql'
    // before calling, so this is the failure path a bad request takes.
    const query: Query = { kind: 'spreadsheet', fileId: 'f-1', sql: 'SELECT 1' };

    expect(() => validateQuery(query, 'postgres')).toThrow();
    expect(query.sql).toBe('SELECT 1');
  });

  it('still throws on a dangerous query without having mutated anything', () => {
    const query: Query = { kind: 'sql', sql: 'SELECT 1; DROP TABLE users' };

    expect(() => validateQuery(query, 'postgres')).toThrow();
    expect(query.sql).toBe('SELECT 1; DROP TABLE users');
  });
});

describe('executeWithTimeout — executes the normalized SQL', () => {
  const executed: string[] = [];

  const connector: Connector = {
    type: 'postgres',
    testConnection: async () => ({ ok: true, latencyMs: 1 }),
    getSchema: async () => ({ tables: [] }),
    executeQuery: vi.fn(async (query: Query) => {
      executed.push((query as { sql: string }).sql);
      return { rows: [], rowCount: 0, executionTimeMs: 1 };
    }),
  };

  beforeEach(() => {
    executed.length = 0;
    vi.clearAllMocks();
  });

  it('runs the LIMIT-normalized SQL and hands the caller an unmodified query', async () => {
    const query: Query = { kind: 'sql', sql: 'SELECT * FROM orders', params: [] };

    await executeWithTimeout(connector, 'ds-1', query);

    expect(executed).toEqual(['SELECT * FROM orders LIMIT 10000']);
    expect(query.sql).toBe('SELECT * FROM orders');
  });
});