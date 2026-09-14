import { PostgresConnector } from './implementations/postgres';
import { StripeConnector } from './implementations/stripe';
import { SheetsConnector } from './implementations/sheets';
import { SpreadsheetConnector } from './implementations/spreadsheet';
import { MysqlConnector } from './implementations/mysql';
import { ShopifyConnector } from './implementations/shopify';
import { HubspotConnector } from './implementations/hubspot';
import { GA4Connector } from './implementations/ga4';
import { SnowflakeConnector } from './implementations/snowflake';
import type { Connector, ConnectorConfig, ConnectorType } from './types';

// Registry of supported MVP connector implementations. Sprint 1.5 adds
// `csv` / `excel` / `spreadsheet` which all map to the same
// SpreadsheetConnector class — the difference is format metadata stored
// in the data_sources row (see `app/src/lib/connectors/types.ts`).
// Tier 2 (post-MVP) adds hubspot / ga4 / snowflake.
// `Partial` because Tier 2 connectors (hubspot/ga4/snowflake) land
// in separate slices and may not all be present at the same time.
// `createConnector` throws if the type is missing — see below.
const registry: Partial<
  Record<
    Extract<
      ConnectorType,
      'postgres' | 'stripe' | 'sheets' | 'csv' | 'excel' | 'spreadsheet' | 'mysql' | 'shopify' | 'hubspot' | 'ga4' | 'snowflake'
    >,
    new (config: ConnectorConfig) => Connector
  >
> = {
  postgres: PostgresConnector,
  stripe: StripeConnector,
  sheets: SheetsConnector,
  csv: SpreadsheetConnector,
  excel: SpreadsheetConnector,
  spreadsheet: SpreadsheetConnector,
  mysql: MysqlConnector,
  shopify: ShopifyConnector,
  hubspot: HubspotConnector,
  ga4: GA4Connector,
  snowflake: SnowflakeConnector,
};

export function createConnector(config: ConnectorConfig): Connector {
  // ConnectorType includes future types (`meta-ads`, `notion`) that
  // the registry does not yet know about. Casting is safe because the
  // throw below handles unknown values at runtime.
  const Ctor = registry[config.type as keyof typeof registry];
  if (!Ctor) {
    throw new Error(`Unsupported or un-implemented connector type: ${config.type}`);
  }
  return new Ctor(config);
}