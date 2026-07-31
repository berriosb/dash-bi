import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShopifyConnector } from '@/lib/connectors/implementations/shopify';
import { encryptApiKey } from '@/lib/security/encryption';
import { SSRFError } from '@/lib/security/validate-connection';

const globalFetchMock = vi.fn();
global.fetch = globalFetchMock;

describe('ShopifyConnector', () => {
  const validConfig = {
    shopUrl: 'mi-tienda-online.myshopify.com',
    accessToken: 'shpat_1234567890abcdef',
  };

  const connectorConfig = {
    id: 'conn_shopify_1',
    orgId: 'org_test_1',
    type: 'shopify' as const,
    name: 'Tienda Shopify Principal',
    configEncrypted: encryptApiKey(JSON.stringify(validConfig)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects connection to internal/SSRF hosts (e.g. localhost or 169.254.169.254)', () => {
    const dangerousConfig = { ...validConfig, shopUrl: 'localhost' };
    const dangerousConnectorConfig = {
      ...connectorConfig,
      configEncrypted: encryptApiKey(JSON.stringify(dangerousConfig)),
    };

    expect(() => new ShopifyConnector(dangerousConnectorConfig)).toThrow(SSRFError);
  });

  it('tests connection successfully against Shopify Admin API', async () => {
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ shop: { id: 9876, name: 'Mi Tienda Online', domain: 'mi-tienda-online.myshopify.com' } }),
    });

    const connector = new ShopifyConnector(connectorConfig);
    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(globalFetchMock).toHaveBeenCalledWith(
      'https://mi-tienda-online.myshopify.com/admin/api/2024-01/shop.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Shopify-Access-Token': 'shpat_1234567890abcdef',
        }),
      }),
    );
  });

  it('returns structured schema for Shopify e-commerce entities', async () => {
    const connector = new ShopifyConnector(connectorConfig);
    const schema = await connector.getSchema();

    expect(schema.tables.length).toBeGreaterThanOrEqual(3);
    const tableNames = schema.tables.map((t) => t.name);
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('customers');
  });

  it('fetches and normalizes orders from Shopify API', async () => {
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        orders: [
          { id: 1001, order_number: 1001, total_price: '150.00', currency: 'USD', created_at: '2026-01-01T12:00:00Z' },
          { id: 1002, order_number: 1002, total_price: '89.90', currency: 'USD', created_at: '2026-01-02T15:30:00Z' },
        ],
      }),
    });

    const connector = new ShopifyConnector(connectorConfig);
    const result = await connector.executeQuery({
      kind: 'sql',
      sql: 'SELECT * FROM orders',
    });

    expect(result.rows.length).toBe(2);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        id: 1001,
        total_price: '150.00',
        currency: 'USD',
      }),
    );
  });
});
