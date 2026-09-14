import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GA4Connector } from '@/lib/connectors/implementations/ga4';
import { encryptApiKey } from '@/lib/security/encryption';
import type { ConnectorConfig } from '@/lib/connectors/types';

const globalFetchMock = vi.fn();
global.fetch = globalFetchMock;

describe('GA4Connector', () => {
  const validConfig = {
    // Service account JSON, OR OAuth access token; we keep them in the
    // same field for now and let the connector decide based on prefix.
    accessToken: 'ya29.a0AfH6SMBxxxx-access-token-xxxx',
    propertyId: '123456789',
  };

  const baseConnectorConfig: ConnectorConfig = {
    id: 'conn_ga4_1',
    orgId: 'org_test_1',
    type: 'ga4',
    name: 'GA4 Producción',
    configEncrypted: encryptApiKey(JSON.stringify(validConfig)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction & secrets', () => {
    it('decrypts the BYOK config and exposes type = "ga4"', () => {
      const c = new GA4Connector(baseConnectorConfig);
      expect(c.type).toBe('ga4');
    });

    it('throws if the decrypted config is malformed JSON', () => {
      const broken: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey('{not-json'),
      };
      expect(() => new GA4Connector(broken)).toThrow();
    });

    it('throws if accessToken is missing', () => {
      const noToken: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey(JSON.stringify({ propertyId: '123' })),
      };
      expect(() => new GA4Connector(noToken)).toThrow(/accessToken.*required/i);
    });

    it('throws if propertyId is missing', () => {
      const noProp: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey(JSON.stringify({ accessToken: 'ya29.xxxx' })),
      };
      expect(() => new GA4Connector(noProp)).toThrow(/propertyId.*required/i);
    });

    it('never logs the plaintext accessToken (T5 redaction guard)', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        expect(() => new GA4Connector(baseConnectorConfig)).not.toThrow();
        const allCalls = [...errSpy.mock.calls, ...logSpy.mock.calls]
          .map((args) => args.map(String).join(' '))
          .join('\n');
        expect(allCalls).not.toContain(validConfig.accessToken);
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  describe('testConnection()', () => {
    it('hits analyticsdata.googleapis.com with the propertyId + Bearer auth', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          rowCount: '0',
          metadata: { dimensions: [], metrics: [] },
          rows: [],
        }),
      });

      const c = new GA4Connector(baseConnectorConfig);
      const result = await c.testConnection();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(globalFetchMock).toHaveBeenCalledWith(
        expect.stringContaining('analyticsdata.googleapis.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${validConfig.accessToken}`,
          }),
        }),
      );
    });

    it('returns ok=false with status info on 401', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: { message: 'Invalid token' } }),
      });

      const c = new GA4Connector(baseConnectorConfig);
      const result = await c.testConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/401/);
      expect(result.error).not.toContain(validConfig.accessToken);
    });

    it('returns ok=false with a clean error on network failure', async () => {
      globalFetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      const c = new GA4Connector(baseConnectorConfig);
      const result = await c.testConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ETIMEDOUT/);
    });
  });

  describe('getSchema()', () => {
    it('returns GA4 entities: sessions, users, events, conversions', async () => {
      const c = new GA4Connector(baseConnectorConfig);
      const schema = await c.getSchema();

      const names = schema.tables.map((t) => t.name);
      expect(names).toContain('sessions');
      expect(names).toContain('users');
      expect(names).toContain('events');
      expect(names).toContain('conversions');
    });

    it('each table has columns matching GA4 dimensions/metrics', async () => {
      const c = new GA4Connector(baseConnectorConfig);
      const schema = await c.getSchema();

      const sessions = schema.tables.find((t) => t.name === 'sessions');
      expect(sessions).toBeDefined();
      const colNames = sessions!.columns.map((c) => c.name);
      expect(colNames).toEqual(
        expect.arrayContaining(['date', 'sessions', 'engagedSessions', 'conversions']),
      );
    });
  });

  describe('executeQuery() with kind "ga4"', () => {
    it('posts a runReport request with the metrics + dateRanges from the query', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          rowCount: '2',
          rows: [
            { dimensionValues: [{ value: '20260101' }], metricValues: [{ value: '150' }] },
            { dimensionValues: [{ value: '20260102' }], metricValues: [{ value: '180' }] },
          ],
        }),
      });

      const c = new GA4Connector(baseConnectorConfig);
      const result = await c.executeQuery({
        kind: 'ga4',
        metrics: ['sessions'],
        dimensions: ['date'],
        dateRange: { startDate: '2026-01-01', endDate: '2026-01-02' },
      });

      expect(result.rowCount).toBe(2);
      // The connector flattens GA4's dimensionValues/metricValues arrays
      // into plain columns. GA4 returns numeric values as strings; the
      // connector coerces them to numbers for downstream widget formatters.
      expect(result.rows[0]).toMatchObject({ date: '20260101', sessions: 150 });

      // Confirm the request was shaped correctly. GA4 uses `:` as the
// separator before the method (`properties/{id}:runReport`), not `/`.
      const [url, init] = globalFetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/v1beta\/properties\/.+:runReport/);
      expect(url).toContain(validConfig.propertyId);
      const body = JSON.parse(init.body as string);
      expect(body.metrics).toEqual([{ name: 'sessions' }]);
      expect(body.dimensions).toEqual([{ name: 'date' }]);
      expect(body.dateRanges).toEqual([{ startDate: '2026-01-01', endDate: '2026-01-02' }]);
    });

    it('rejects unknown query kinds', async () => {
      const c = new GA4Connector(baseConnectorConfig);
      await expect(
        c.executeQuery({ kind: 'sql', sql: 'SELECT 1' } as never),
      ).rejects.toThrow(/GA4 expects|ga4|kind/i);
    });

    it('rejects queries with no metrics', async () => {
      const c = new GA4Connector(baseConnectorConfig);
      await expect(
        c.executeQuery({
          kind: 'ga4',
          metrics: [],
          dimensions: ['date'],
          dateRange: { startDate: '2026-01-01', endDate: '2026-01-02' },
        }),
      ).rejects.toThrow(/at least one metric/i);
    });

    it('rejects date ranges where startDate > endDate', async () => {
      const c = new GA4Connector(baseConnectorConfig);
      await expect(
        c.executeQuery({
          kind: 'ga4',
          metrics: ['sessions'],
          dimensions: ['date'],
          dateRange: { startDate: '2026-02-01', endDate: '2026-01-01' },
        }),
      ).rejects.toThrow(/date range|start.*end/i);
    });

    it('throws a clean error on 403 (no token leak)', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: { message: 'Insufficient permissions' } }),
      });

      const c = new GA4Connector(baseConnectorConfig);
      await expect(
        c.executeQuery({
          kind: 'ga4',
          metrics: ['sessions'],
          dimensions: ['date'],
          dateRange: { startDate: '2026-01-01', endDate: '2026-01-02' },
        }),
      ).rejects.toThrow(/GA4 query failed.*403/);
    });
  });
});