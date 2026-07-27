import { describe, it, expect } from 'vitest';
import { createConnector } from '@/lib/connectors/registry';
import { encryptApiKey } from '@/lib/security/encryption';
import type { ConnectorConfig } from '@/lib/connectors/types';

const TEST_KEY = 'a'.repeat(64);

describe('Connectors System', () => {
  it('instantiates PostgresConnector via registry', () => {
    const config: ConnectorConfig = {
      id: 'ds-1',
      orgId: 'org-1',
      type: 'postgres',
      name: 'Test DB',
      configEncrypted: encryptApiKey(
        JSON.stringify({
          host: 'db.example.com',
          port: 5432,
          database: 'test',
          username: 'user',
          password: 'pass',
        }),
        TEST_KEY,
      ),
    };

    const connector = createConnector(config);
    expect(connector.type).toBe('postgres');
    expect(typeof connector.testConnection).toBe('function');
    expect(typeof connector.getSchema).toBe('function');
    expect(typeof connector.executeQuery).toBe('function');
  });

  it('instantiates StripeConnector via registry', () => {
    const config: ConnectorConfig = {
      id: 'ds-2',
      orgId: 'org-1',
      type: 'stripe',
      name: 'Stripe Prod',
      configEncrypted: encryptApiKey(
        JSON.stringify({
          apiKey: 'sk_test_aaaaaaaaaaaaaaaaaaaaaaa',
        }),
        TEST_KEY,
      ),
    };

    const connector = createConnector(config);
    expect(connector.type).toBe('stripe');
  });

  it('rejects unsupported connector types', () => {
    const config: ConnectorConfig = {
      id: 'ds-3',
      orgId: 'org-1',
      type: 'shopify' as never,
      name: 'Shopify Store',
      configEncrypted: 'mock',
    };

    expect(() => createConnector(config)).toThrow('Unsupported or un-implemented connector type');
  });

  // T6: SSRF defense in depth — connector must validate host on instantiation,
  // not just on POST /api/data-sources.
  it('rejects PostgresConnector pointing at private IP (SSRF)', () => {
    const config: ConnectorConfig = {
      id: 'ds-ssrf-1',
      orgId: 'org-1',
      type: 'postgres',
      name: 'SSRF Attempt',
      configEncrypted: encryptApiKey(
        JSON.stringify({
          host: '169.254.169.254', // AWS metadata
          port: 5432,
          database: 'test',
          username: 'user',
          password: 'pass',
        }),
        TEST_KEY,
      ),
    };

    expect(() => createConnector(config)).toThrow(/not allowed/i);
  });

  it('rejects PostgresConnector pointing at localhost (SSRF)', () => {
    const config: ConnectorConfig = {
      id: 'ds-ssrf-2',
      orgId: 'org-1',
      type: 'postgres',
      name: 'SSRF Localhost',
      configEncrypted: encryptApiKey(
        JSON.stringify({
          host: 'localhost',
          port: 5432,
          database: 'test',
          username: 'user',
          password: 'pass',
        }),
        TEST_KEY,
      ),
    };

    expect(() => createConnector(config)).toThrow(/not allowed/i);
  });
});
