import { PostgresConnector } from './implementations/postgres';
import { StripeConnector } from './implementations/stripe';
import { SheetsConnector } from './implementations/sheets';
import { SpreadsheetConnector } from './implementations/spreadsheet';
import { MysqlConnector } from './implementations/mysql';
import type { Connector, ConnectorConfig, ConnectorType } from './types';

// Registry of supported MVP connector implementations. Sprint 1.5 adds
// `csv` / `excel` / `spreadsheet` which all map to the same
// SpreadsheetConnector class — the difference is format metadata stored
// in the data_sources row (see `app/src/lib/connectors/types.ts`).
const registry: Record<
  Extract<ConnectorType, 'postgres' | 'stripe' | 'sheets' | 'csv' | 'excel' | 'spreadsheet' | 'mysql'>,
  new (config: ConnectorConfig) => Connector
> = {
  postgres: PostgresConnector,
  stripe: StripeConnector,
  sheets: SheetsConnector,
  csv: SpreadsheetConnector,
  excel: SpreadsheetConnector,
  spreadsheet: SpreadsheetConnector,
  mysql: MysqlConnector,
};

export function createConnector(config: ConnectorConfig): Connector {
  const Ctor = registry[config.type as keyof typeof registry];
  if (!Ctor) {
    throw new Error(`Unsupported or un-implemented connector type: ${config.type}`);
  }
  return new Ctor(config);
}