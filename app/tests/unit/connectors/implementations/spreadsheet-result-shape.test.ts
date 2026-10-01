import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpreadsheetConnector } from '@/lib/connectors/implementations/spreadsheet';
import { encryptApiKey } from '@/lib/security/encryption';
import type { ConnectorConfig } from '@/lib/connectors/types';

const TEST_KEY = 'a'.repeat(64);
const ORG_ID = '11111111-1111-1111-1111-111111111111';
const FILE_ID = 'file-1';

const mockWithOrgContext = vi.fn();

vi.mock('@/db/client', () => ({
  db: { execute: vi.fn(), transaction: vi.fn() },
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
  withOrgContextReadOnly: vi.fn(),
}));

function buildConfig(): ConnectorConfig {
  return {
    id: 'ds-1',
    orgId: ORG_ID,
    type: 'csv',
    name: 'Sales',
    configEncrypted: encryptApiKey(JSON.stringify({ fileId: FILE_ID }), TEST_KEY),
  };
}

const FILE_ROW = {
  id: FILE_ID,
  orgId: ORG_ID,
  targetTable: 'org_11111111_1111.sales',
  columns: [{ name: 'monto', type: 'number', nullable: false }],
};

const QUERY = {
  kind: 'spreadsheet' as const,
  fileId: FILE_ID,
  sql: 'SELECT monto FROM "org_11111111_1111"."sales" LIMIT 100',
};

/**
 * A tx that serves both calls the connector makes through withOrgContext: the
 * file lookup (a select chain) and the query itself (execute).
 */
function fakeTx(executeResult: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [FILE_ROW] }),
      }),
    }),
    execute: vi.fn(async () => executeResult),
  };
}

describe('SpreadsheetConnector.executeQuery — result shape', () => {
  beforeEach(() => vi.clearAllMocks());

  function runWith(executeResult: unknown) {
    const tx = fakeTx(executeResult);
    mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
      const fn = args[args.length - 1] as (t: unknown) => Promise<unknown>;
      return fn(tx);
    });
    return new SpreadsheetConnector(buildConfig()).executeQuery(QUERY);
  }

  it('returns the rows the driver produced', async () => {
    // Drizzle's postgres-js driver resolves execute() with the rows array
    // itself, not with `{ rows }`. The alert evaluator's extractValue() already
    // treats its input as an array; this connector was the one that disagreed,
    // and its `?? []` turned the mismatch into "the dashboard is empty".
    const rows = [{ monto: 10 }, { monto: 20 }];
    const result = await runWith(rows);

    expect(result.rows).toEqual(rows);
    expect(result.rowCount).toBe(2);
  });

  it('reports zero rows rather than throwing when the query returns none', async () => {
    const result = await runWith([]);

    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('does not silently return zero rows when the driver shape is unexpected', async () => {
    // The `?? []` that hid this bug would swallow a future shape change just as
    // quietly. A wrong shape should be loud.
    await expect(runWith(undefined)).rejects.toThrow();
    await expect(runWith({ rows: [{ monto: 1 }] })).rejects.toThrow();
  });
});
