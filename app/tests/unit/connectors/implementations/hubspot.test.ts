import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HubspotConnector } from '@/lib/connectors/implementations/hubspot';
import { encryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';
import type { ConnectorConfig } from '@/lib/connectors/types';

const globalFetchMock = vi.fn();
global.fetch = globalFetchMock;

describe('HubspotConnector', () => {
  const validConfig = {
    accessToken: 'pat-na1-1234567890abcdef1234567890abcdef',
  };

  const baseConnectorConfig: ConnectorConfig = {
    id: 'conn_hubspot_1',
    orgId: 'org_test_1',
    type: 'hubspot',
    name: 'HubSpot Producción',
    configEncrypted: encryptApiKey(JSON.stringify(validConfig)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction & secrets', () => {
    it('decrypts the BYOK config and exposes `type = "hubspot"`', () => {
      const c = new HubspotConnector(baseConnectorConfig);
      expect(c.type).toBe('hubspot');
    });

    it('throws if the decrypted config is malformed JSON', () => {
      const broken: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey('{not-json'),
      };
      expect(() => new HubspotConnector(broken)).toThrow();
    });

    it('throws if accessToken is missing', () => {
      const noToken: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey(JSON.stringify({})),
      };
      expect(() => new HubspotConnector(noToken)).toThrow(/accessToken.*required/i);
    });

    it('throws if accessToken is empty string', () => {
      const empty: ConnectorConfig = {
        ...baseConnectorConfig,
        configEncrypted: encryptApiKey(JSON.stringify({ accessToken: '' })),
      };
      expect(() => new HubspotConnector(empty)).toThrow(/accessToken.*required/i);
    });

    it('never logs the plaintext accessToken (T5 redaction guard)', () => {
      const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        // Construction itself must not leak the token in errors.
        expect(() => new HubspotConnector(baseConnectorConfig)).not.toThrow();
        const allCalls = [...consoleErrSpy.mock.calls, ...consoleLogSpy.mock.calls]
          .map((args) => args.map(String).join(' '))
          .join('\n');
        expect(allCalls).not.toContain(validConfig.accessToken);
      } finally {
        consoleErrSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });
  });

  describe('testConnection()', () => {
    it('hits api.hubapi.com with Bearer auth and a tiny probe', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [], total: 0 }),
      });

      const c = new HubspotConnector(baseConnectorConfig);
      const result = await c.testConnection();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(globalFetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.hubapi.com/crm/v3/objects/contacts'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${validConfig.accessToken}`,
          }),
        }),
      );
    });

    it('returns ok=false with the upstream status on 401 (bad token)', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Bad token' }),
      });

      const c = new HubspotConnector(baseConnectorConfig);
      const result = await c.testConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/401/);
      // The raw token must NOT appear in the user-facing error.
      expect(result.error).not.toContain(validConfig.accessToken);
    });

    it('returns ok=false with a clean error on network failure', async () => {
      globalFetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const c = new HubspotConnector(baseConnectorConfig);
      const result = await c.testConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ECONNREFUSED/);
    });
  });

  describe('getSchema()', () => {
    it('returns CRM entities: contacts, companies, deals', async () => {
      const c = new HubspotConnector(baseConnectorConfig);
      const schema = await c.getSchema();

      const names = schema.tables.map((t) => t.name);
      expect(names).toContain('contacts');
      expect(names).toContain('companies');
      expect(names).toContain('deals');
    });

    it('each table exposes typed columns matching Hubspot CRM properties', async () => {
      const c = new HubspotConnector(baseConnectorConfig);
      const schema = await c.getSchema();

      const contacts = schema.tables.find((t) => t.name === 'contacts');
      expect(contacts).toBeDefined();
      const colNames = contacts!.columns.map((c) => c.name);
      expect(colNames).toEqual(
        expect.arrayContaining(['id', 'email', 'firstname', 'lastname', 'lifecyclestage', 'createdate']),
      );
    });
  });

  describe('executeQuery()', () => {
    it('maps `FROM contacts` to the contacts endpoint and flattens properties', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              id: '1001',
              properties: {
                email: 'alice@example.com',
                firstname: 'Alice',
                lastname: 'Doe',
                lifecyclestage: 'customer',
                createdate: '2026-01-15T10:00:00Z',
              },
              createdAt: '2026-01-15T10:00:00Z',
              updatedAt: '2026-01-16T11:00:00Z',
              archived: false,
            },
          ],
        }),
      });

      const c = new HubspotConnector(baseConnectorConfig);
      const result = await c.executeQuery({
        kind: 'sql',
        sql: 'SELECT * FROM contacts LIMIT 50',
      });

      expect(result.rowCount).toBe(1);
      expect(result.rows[0]).toMatchObject({
        id: '1001',
        email: 'alice@example.com',
        firstname: 'Alice',
        lastname: 'Doe',
        lifecyclestage: 'customer',
      });
    });

    it('maps `FROM companies` to the companies endpoint', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { id: '2001', properties: { name: 'Acme', domain: 'acme.com' } },
          ],
        }),
      });

      const c = new HubspotConnector(baseConnectorConfig);
      await c.executeQuery({ kind: 'sql', sql: 'SELECT * FROM companies' });

      const [url] = globalFetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/\/crm\/v3\/objects\/companies/);
    });

    it('maps `FROM deals` to the deals endpoint', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });
      const c = new HubspotConnector(baseConnectorConfig);
      await c.executeQuery({ kind: 'sql', sql: 'SELECT * FROM deals' });

      const [url] = globalFetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/\/crm\/v3\/objects\/deals/);
    });

    it('rejects non-SELECT SQL (validateQuery guard)', async () => {
      const c = new HubspotConnector(baseConnectorConfig);
      await expect(
        c.executeQuery({ kind: 'sql', sql: 'DELETE FROM contacts' }),
      ).rejects.toThrow(/Only SELECT queries allowed/);
    });

    it('rejects queries against unknown resources', async () => {
      const c = new HubspotConnector(baseConnectorConfig);
      await expect(
        c.executeQuery({ kind: 'sql', sql: 'SELECT * FROM tickets' }),
      ).rejects.toThrow(/Unsupported resource|hubspot/i);
    });

    it('blocks sensitive columns (PII protection) for viewer role', async () => {
      const c = new HubspotConnector(baseConnectorConfig);
      // Validate the query as a viewer with a PII-ish column; assertRolePermissions
      // must trip on the `password|secret|api_key|token|...` regex even for hubspot.
      expect(() =>
        validateQuery({ kind: 'sql', sql: 'SELECT api_key FROM contacts' }, 'hubspot', 'viewer'),
      ).toThrow(/viewer.*sensitive|PII/i);
    });

    it('throws a clean error (no token leak) on upstream 5xx', async () => {
      globalFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ message: 'Hubspot down' }),
      });

      const c = new HubspotConnector(baseConnectorConfig);
      await expect(
        c.executeQuery({ kind: 'sql', sql: 'SELECT * FROM contacts' }),
      ).rejects.toThrow(/Hubspot query failed.*503/);
    });
  });
});