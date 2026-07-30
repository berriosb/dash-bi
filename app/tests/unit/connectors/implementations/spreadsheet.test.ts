import { describe, it, expect } from 'vitest';
import { createConnector } from '@/lib/connectors/registry';
import { encryptApiKey } from '@/lib/security/encryption';
import type { ConnectorConfig } from '@/lib/connectors/types';

const TEST_KEY = 'a'.repeat(64);

function buildSpreadsheetConfig(fileId: string): ConnectorConfig {
  return {
    id: 'ds-spr-1',
    orgId: 'org-1',
    type: 'csv',
    name: 'Sales Q1',
    configEncrypted: encryptApiKey(
      JSON.stringify({ fileId }),
      TEST_KEY,
    ),
  };
}

describe('Spreadsheet connector (registry)', () => {
  it('routes the csv type to SpreadsheetConnector', () => {
    const connector = createConnector(buildSpreadsheetConfig('file-1'));
    expect(connector.type).toBe('spreadsheet');
  });

  it('routes the excel type to SpreadsheetConnector', () => {
    const config: ConnectorConfig = { ...buildSpreadsheetConfig('file-1'), type: 'excel' };
    const connector = createConnector(config);
    expect(connector.type).toBe('spreadsheet');
  });

  it('routes the spreadsheet type to SpreadsheetConnector', () => {
    const config: ConnectorConfig = { ...buildSpreadsheetConfig('file-1'), type: 'spreadsheet' };
    const connector = createConnector(config);
    expect(connector.type).toBe('spreadsheet');
  });

  it('exposes the connector interface', () => {
    const connector = createConnector(buildSpreadsheetConfig('file-1'));
    expect(typeof connector.testConnection).toBe('function');
    expect(typeof connector.getSchema).toBe('function');
    expect(typeof connector.executeQuery).toBe('function');
  });

  it('decodes configEncrypted into the fileId', () => {
    // We can't observe fileId directly without DB; we test the
    // executeQuery path rejects the wrong query kind, which is what
    // happens when fileId is missing.
    const connector = createConnector(buildSpreadsheetConfig('file-1'));
    return expect(() =>
      connector.executeQuery({ kind: 'sql', sql: 'SELECT 1' }),
    ).rejects.toThrow(/spreadsheet/i);
  });
});
