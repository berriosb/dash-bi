import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpreadsheetConnector } from '@/lib/connectors/implementations/spreadsheet';
import { buildReadOnlyGrantsSQL } from '@/lib/connectors/parsers/load';
import { encryptApiKey } from '@/lib/security/encryption';
import type { ConnectorConfig } from '@/lib/connectors/types';

const TEST_KEY = 'a'.repeat(64);
const ORG_ID = '11111111-1111-1111-1111-111111111111';
const FILE_ID = 'file-1';

const mockWithOrgContext = vi.fn();
const mockWithOrgContextReadOnly = vi.fn();

vi.mock('@/db/client', () => ({
  db: { execute: vi.fn(), transaction: vi.fn() },
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
  withOrgContextReadOnly: (...args: unknown[]) => mockWithOrgContextReadOnly(...args),
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
 * Metadata lookup (SELECT on `uploaded_files`) needs the app role; the
 * user-supplied SQL must run as `dashbi_readonly`. Two distinct fakes so a
 * test can assert which role executed what.
 */
function makeFakeTx(executeResult: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [FILE_ROW] }),
      }),
    }),
    execute: vi.fn(async () => executeResult),
  };
}

function wireContexts() {
  mockWithOrgContext.mockImplementation(async (_org, _user, fn) =>
    fn(makeFakeTx([{ monto: 1 }])),
  );
  mockWithOrgContextReadOnly.mockImplementation(async (_org, _user, fn) =>
    fn(makeFakeTx([{ monto: 42 }])),
  );
}

describe('SpreadsheetConnector — SQL runs on the read-only role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireContexts();
  });

  it('reads the file metadata with the app role but runs the query read-only', async () => {
    const connector = new SpreadsheetConnector(buildConfig());
    const result = await connector.executeQuery({ ...QUERY });

    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockWithOrgContextReadOnly).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([{ monto: 42 }]);
  });

  it('probes the table with the read-only role in testConnection', async () => {
    mockWithOrgContextReadOnly.mockImplementation(async (_org, _user, fn) =>
      fn(makeFakeTx([{ '?column?': 1 }])),
    );

    const connector = new SpreadsheetConnector(buildConfig());
    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(mockWithOrgContextReadOnly).toHaveBeenCalledTimes(1);
  });
});

describe('buildReadOnlyGrantsSQL', () => {
  it('grants USAGE on the per-org schema and SELECT on the table to the read-only role', () => {
    const grants = buildReadOnlyGrantsSQL('org_11111111_1111.sales');

    expect(grants).toContain('GRANT USAGE ON SCHEMA %I TO dashbi_readonly');
    expect(grants).toContain('GRANT SELECT ON TABLE %I.%I TO dashbi_readonly');
    // The identifiers are arguments to `%I`, not interpolated SQL.
    expect(grants).toContain("'org_11111111_1111', 'sales'");
  });

  it('is idempotent and tolerates a deployment without the read-only role', () => {
    const grants = buildReadOnlyGrantsSQL('org_11111111_1111.sales');

    expect(grants).toContain('pg_roles');
    expect(grants).toContain('IF EXISTS');
    expect(grants).toContain('GRANT'); // not CREATE GRANT, so re-running is a no-op
  });

  it('rejects an unsafe target table instead of interpolating it', () => {
    expect(() => buildReadOnlyGrantsSQL('public.sales"; DROP TABLE users; --')).toThrow();
  });
});