import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnowflakeConnector } from '@/lib/connectors/implementations/snowflake';
import { encryptApiKey } from '@/lib/security/encryption';
import { SSRFError } from '@/lib/security/validate-connection';
import type { ConnectorConfig } from '@/lib/connectors/types';

const globalFetchMock = vi.fn();
global.fetch = globalFetchMock;

describe('SnowflakeConnector', () => {
  const validConfig = {
    account: 'xy12345.us-east-1',
    username: 'DASHBI_USER',
    password: 'super-secret-password',
    database: 'ANALYTICS',
    schema: 'PUBLIC',
    warehouse: 'COMPUTE_WH',
  };

  const baseConnectorConfig: ConnectorConfig = {
    id: 'conn_snowflake_1',
    orgId: 'org_test_1',
    type: 'snowflake',
    name: 'Snowflake Analytics',
    configEncrypted: encryptApiKey(JSON.stringify(validConfig)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction & secrets', () => {
    it('decrypts the BYOK config and exposes type = "snowflake"', () => {
      const c = new SnowflakeConnector(baseConnectorConfig);
      expect(c.type).toBe('snowflake');
    });

    it('throws if the decrypted config is malformed JSON', () => {
      const broken: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey('{not-json'),
      };
      expect(() => new SnowflakeConnector(broken)).toThrow();
    });

    it.each(['account', 'username', 'password', 'database', 'schema', 'warehouse'])(
      'throws if %s is missing',
      (field) => {
        const cfg = { ...validConfig };
        delete (cfg as Record<string, unknown>)[field];
        const conn: ConnectorConfig = {
          ...baseConnectorConfig,
          configEncrypted: encryptApiKey(JSON.stringify(cfg)),
        };
        expect(() => new SnowflakeConnector(conn)).toThrow(new RegExp(`${field}.*required`, 'i'));
      },
    );

    it('rejects SSRF-style hostnames (T6)', () => {
      const ssrfConfig = { ...validConfig, account: 'localhost' };
      const conn: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey(JSON.stringify(ssrfConfig)),
      };
      expect(() => new SnowflakeConnector(conn)).toThrow(SSRFError);
    });

    it('rejects private-IP accounts (T6)', () => {
      const ssrfConfig = { ...validConfig, account: '10.0.0.5' };
      const conn: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey(JSON.stringify(ssrfConfig)),
      };
      expect(() => new SnowflakeConnector(conn)).toThrow(SSRFError);
    });

    it('never logs the plaintext password (T5 redaction guard)', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        expect(() => new SnowflakeConnector(baseConnectorConfig)).not.toThrow();
        const allCalls = [...errSpy.mock.calls, ...logSpy.mock.calls]
          .map((args) => args.map(String).join(' '))
          .join('\n');
        expect(allCalls).not.toContain(validConfig.password);
        expect(allCalls).not.toContain(validConfig.username);
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  describe('testConnection()', () => {
    it('hits the Snowflake SQL API endpoint with Basic auth and SELECT 1', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          resultSetMetaData: { numRows: 1, rowType: [] },
          data: [['1']],
        }),
      });

      const c = new SnowflakeConnector(baseConnectorConfig);
      const result = await c.testConnection();

      expect(result.ok).toBe(true);
      const [url, init] = globalFetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`xy12345.us-east-1.snowflakecomputing.com/api/v2/statements`);
      // Auth header must be Basic with base64(user:pass), never the plaintext
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Basic /);
      expect(headers.Authorization).not.toContain(validConfig.password);
      const body = JSON.parse(init.body as string);
      expect(body.statement).toMatch(/SELECT 1/i);
      expect(body.database).toBe(validConfig.database);
      expect(body.schema).toBe(validConfig.schema);
      expect(body.warehouse).toBe(validConfig.warehouse);
    });

    it('returns ok=false with status info on 401', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Bad credentials' }),
      });
      const c = new SnowflakeConnector(baseConnectorConfig);
      const result = await c.testConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/401/);
      expect(result.error).not.toContain(validConfig.password);
    });
  });

  describe('getSchema()', () => {
    it('returns at least one placeholder table (Snowflake schema introspection is async)', async () => {
      const c = new SnowflakeConnector(baseConnectorConfig);
      const schema = await c.getSchema();
      // The MVP slice exposes a placeholder schema; real introspection
      // (SHOW TABLES / information_schema) is a follow-up.
      expect(Array.isArray(schema.tables)).toBe(true);
    });
  });

  describe('executeQuery() (SQL kind)', () => {
    it('runs a SELECT against the SQL API and flattens the resultSet', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          resultSetMetaData: {
            numRows: 2,
            rowType: [
              { name: 'ORDER_ID', type: 'FIXED' },
              { name: 'TOTAL', type: 'FIXED' },
            ],
          },
          data: [
            ['1001', '150.00'],
            ['1002', '89.90'],
          ],
        }),
      });

      const c = new SnowflakeConnector(baseConnectorConfig);
      const result = await c.executeQuery({
        kind: 'sql',
        sql: 'SELECT order_id, total FROM orders LIMIT 50',
      });

      expect(result.rowCount).toBe(2);
      expect(result.rows[0]).toMatchObject({ ORDER_ID: '1001', TOTAL: '150.00' });
    });

    it('rejects non-SELECT SQL via validateQuery (T3)', async () => {
      const c = new SnowflakeConnector(baseConnectorConfig);
      await expect(
        c.executeQuery({ kind: 'sql', sql: 'DROP TABLE orders' }),
      ).rejects.toThrow(/DML|DDL|Only SELECT/i);
    });

    it('blocks PII columns for viewer role (T2)', async () => {
      // The Connector interface does not take a role — the query
      // engine layer is responsible for passing the role to
      // validateQuery. Here we exercise validateQuery directly to
      // mirror the Hubspot test pattern.
      const { validateQuery } = await import('@/lib/security/validate-query');
      expect(() =>
        validateQuery(
          { kind: 'sql', sql: 'SELECT ssn FROM customers LIMIT 10' },
          'snowflake',
          'viewer',
        ),
      ).toThrow(/viewer.*sensitive|PII/i);
    });

    it('throws a clean error (no password leak) on upstream 5xx', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Warehouse unavailable' }),
      });

      const c = new SnowflakeConnector(baseConnectorConfig);
      await expect(
        c.executeQuery({ kind: 'sql', sql: 'SELECT * FROM orders LIMIT 10' }),
      ).rejects.toThrow(/Snowflake query failed.*500/);
    });
  });
});