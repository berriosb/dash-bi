import { PostgresConnector } from './implementations/postgres';
import { StripeConnector } from './implementations/stripe';
import { SheetsConnector } from './implementations/sheets';
import type { Connector, ConnectorConfig, ConnectorType } from './types';

// Registry of supported MVP connector implementations
const registry: Record<Extract<ConnectorType, 'postgres' | 'stripe' | 'sheets'>, new (config: ConnectorConfig) => Connector> = {
  postgres: PostgresConnector,
  stripe: StripeConnector,
  sheets: SheetsConnector,
};

export function createConnector(config: ConnectorConfig): Connector {
  const Ctor = registry[config.type as keyof typeof registry];
  if (!Ctor) {
    throw new Error(`Unsupported or un-implemented connector type: ${config.type}`);
  }
  return new Ctor(config);
}
