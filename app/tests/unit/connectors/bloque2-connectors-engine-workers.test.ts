import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateQuery } from '@/lib/security/validate-query';
import { executeWithTimeout } from '@/lib/query-engine/execute';
import { SpreadsheetConnector } from '@/lib/connectors/implementations/spreadsheet';
import { MysqlConnector } from '@/lib/connectors/implementations/mysql';
import { buildRLSPoliciesSQL } from '@/lib/connectors/parsers/load';
import { runAlertEvaluator } from '@/lib/alerts/evaluator';
import { encryptApiKey } from '@/lib/security/encryption';
import mysql from 'mysql2/promise';
import type { Connector, ConnectorConfig } from '@/lib/connectors/types';

const mockWithOrgContext = vi.fn();
const mockWithOrgContextReadOnly = vi.fn();
const mockDbExecute = vi.fn();

vi.mock('@/db/client', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
  withOrgContextReadOnly: (...args: unknown[]) => mockWithOrgContextReadOnly(...args),
}));

vi.mock('@/lib/audit/log', () => ({
  audit: vi.fn(),
}));

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => ({
      query: vi.fn(async () => [[{ ok: 1 }]]),
      end: vi.fn(async () => {}),
    })),
  },
}));

describe('Bloque 2 — Connectors, Query Engine & Workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateQuery — LIMIT capping and subquery handling', () => {
    it('clamps an excessive LIMIT (> 10000) down to LIMIT 10000', () => {
      const q = { kind: 'sql' as const, sql: 'SELECT id FROM orders LIMIT 999999999' };
      const normalized = validateQuery(q, 'postgres');
      expect(normalized).toBe('SELECT id FROM orders LIMIT 10000');
      // Pure validator: the caller's object keeps the original statement.
      expect(q.sql).toBe('SELECT id FROM orders LIMIT 999999999');
    });

    it('appends outer LIMIT 10000 when LIMIT only appears inside a subquery', () => {
      const q = {
        kind: 'sql' as const,
        sql: 'SELECT a FROM (SELECT b FROM t LIMIT 5) sub',
      };
      expect(validateQuery(q, 'postgres')).toBe(
        'SELECT a FROM (SELECT b FROM t LIMIT 5) sub LIMIT 10000',
      );
      expect(q.sql).toBe('SELECT a FROM (SELECT b FROM t LIMIT 5) sub');
    });
  });

  describe('executeWithTimeout — spreadsheet support & timer cleanup', () => {
    it('validates spreadsheet queries without throwing kind mismatch and preserves LIMIT 10000', async () => {
      const executeQuery = vi.fn(async () => ({
        rows: [{ a: 1 }],
        rowCount: 1,
        executionTimeMs: 2,
      })) as unknown as Connector['executeQuery'];
      const fakeSpreadsheetConnector: Connector = {
        type: 'spreadsheet',
        testConnection: async () => ({ ok: true, latencyMs: 1 }),
        getSchema: async () => ({ tables: [] }),
        executeQuery,
      };

      const query = {
        kind: 'spreadsheet' as const,
        fileId: 'file-123',
        sql: 'SELECT a FROM "org_1"."sales"',
      };

      await executeWithTimeout(fakeSpreadsheetConnector, 'ds-1', query, {
        role: 'editor',
      });

      expect(executeQuery).toHaveBeenCalledTimes(1);
      // The normalized SQL is what reached the connector…
      expect((executeQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toMatchObject({
        sql: 'SELECT a FROM "org_1"."sales" LIMIT 10000',
      });
      // …and the caller's object is left untouched: `validateQuery` is pure.
      expect(query.sql).toBe('SELECT a FROM "org_1"."sales"');
    });

    it('clears the timeout timer after connector.executeQuery resolves', async () => {
      vi.useFakeTimers();
      try {
        const connector: Connector = {
          type: 'postgres',
          testConnection: async () => ({ ok: true, latencyMs: 1 }),
          getSchema: async () => ({ tables: [] }),
          executeQuery: async () => ({ rows: [], rowCount: 0, executionTimeMs: 1 }),
        };

        await executeWithTimeout(
          connector,
          'ds-timer',
          { kind: 'sql', sql: 'SELECT 1 LIMIT 1' },
          { timeoutMs: 30000 },
        );

        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('SpreadsheetConnector — AES-256-GCM decryption & orgId context', () => {
    const ORG_ID = '11111111-1111-4111-8111-111111111111';
    const FILE_ID = '22222222-2222-4222-8222-222222222222';

    it('decrypts configEncrypted via decryptApiKey and passes connector orgId to withOrgContext', async () => {
      const cfg: ConnectorConfig = {
        id: 'ds-csv-1',
        orgId: ORG_ID,
        type: 'csv',
        name: 'Ventas CSV',
        configEncrypted: encryptApiKey(JSON.stringify({ fileId: FILE_ID })),
      };

      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: FILE_ID,
                  orgId: ORG_ID,
                  targetTable: 'org_11111111.ventas',
                  columns: [{ name: 'total', type: 'number', nullable: false }],
                },
              ],
            }),
          }),
        }),
        execute: vi.fn(async () => [{ total: 100 }]),
      };

      mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
        const fn = args[args.length - 1] as (t: unknown) => Promise<unknown>;
        return fn(tx);
      });

      const connector = new SpreadsheetConnector(cfg);
      const schema = await connector.getSchema();

      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0]?.name).toBe('ventas');
      expect(mockWithOrgContext).toHaveBeenCalledWith(
        ORG_ID,
        null,
        expect.any(Function),
      );
    });
  });

  describe('buildRLSPoliciesSQL — FORCE ROW LEVEL SECURITY', () => {
    it('emits force statement for materialized file tables', () => {
      const rls = buildRLSPoliciesSQL('org_a.sales') as {
        enable: string;
        force?: string;
        policy: string;
      };
      expect(rls.force).toBe('ALTER TABLE "org_a"."sales" FORCE ROW LEVEL SECURITY');
    });
  });

  describe('runAlertEvaluator — Drizzle SQL wrapper', () => {
    it('passes a Drizzle SQL object (not a raw string) to tx.execute and null userId to withOrgContextReadOnly', async () => {
      const ruleId = '33333333-3333-4333-8333-333333333333';
      const orgId = '11111111-1111-4111-8111-111111111111';

      mockDbExecute.mockResolvedValueOnce([
        {
          rule: {
            id: ruleId,
            org_id: orgId,
            name: 'High Churn',
            query_sql: 'SELECT 42 AS val',
            query_columns: { value: 'val' },
            condition: { kind: 'threshold_above', threshold: 100 },
            consecutive_breaches: 0,
            consecutive_breaches_to_fire: 1,
            cooldown_minutes: 60,
            channels: [],
            enabled: true,
            last_fired_at: null,
          },
          dashboard_title: 'Main Dash',
        },
      ]);

      let capturedSqlArg: unknown = null;
      const readonlyTx = {
        execute: vi.fn(async (arg: unknown) => {
          capturedSqlArg = arg;
          return [{ val: 42 }];
        }),
      };

      mockWithOrgContextReadOnly.mockImplementation(async (...args: unknown[]) => {
        const fn = args[args.length - 1] as (t: unknown) => Promise<unknown>;
        return fn(readonlyTx);
      });

      const writeTx = {
        update: () => ({
          set: () => ({
            where: async () => [],
          }),
        }),
      };
      mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
        const fn = args[args.length - 1] as (t: unknown) => Promise<unknown>;
        return fn(writeTx);
      });

      await runAlertEvaluator({
        data: { alertRuleId: ruleId, correlationId: 'corr-1' },
      } as never);

      expect(mockWithOrgContextReadOnly).toHaveBeenCalledWith(
        orgId,
        null,
        expect.any(Function),
      );
      expect(typeof capturedSqlArg).toBe('object');
      expect(capturedSqlArg).not.toBeNull();
      expect('queryChunks' in (capturedSqlArg as Record<string, unknown>)).toBe(true);
    });
  });

  describe('MysqlConnector — connection pool reuse', () => {
    it('reuses the same pool for identical connector id + configEncrypted and exposes close()', async () => {
      const cfg: ConnectorConfig = {
        id: 'ds-mysql-pool-test',
        orgId: 'org-1',
        type: 'mysql',
        name: 'MySQL',
        configEncrypted: encryptApiKey(
          JSON.stringify({
            host: 'db.mysql-pool.example.com',
            port: 3306,
            database: 'app',
            username: 'u',
            password: 'p',
          }),
        ),
      };

      const c1 = new MysqlConnector(cfg);
      const c2 = new MysqlConnector(cfg);

      expect(mysql.createPool).toHaveBeenCalledTimes(1);
      expect(typeof (c1 as { close?: unknown }).close).toBe('function');
      expect(c2.type).toBe('mysql');
    });
  });
});
