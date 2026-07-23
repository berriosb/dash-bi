import { eq, and } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { dataSources } from '@/db/schema';
import { createConnector } from '@/lib/connectors/registry';
import type { Connector, ConnectorConfig, ConnectorType } from '@/lib/connectors/types';

export class DataSourceNotFoundError extends Error {
  constructor(public dataSourceId: string) {
    super(`DataSource not found: ${dataSourceId}`);
    this.name = 'DataSourceNotFoundError';
  }
}

export async function resolveConnector(
  orgId: string,
  userId: string,
  dataSourceId: string,
): Promise<Connector> {
  const dsRow = await withOrgContext(orgId, userId, async (tx) => {
    const rows = await tx
      .select()
      .from(dataSources)
      .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.orgId, orgId)));
    return rows[0] ?? null;
  });

  if (!dsRow) {
    throw new DataSourceNotFoundError(dataSourceId);
  }

  const connectorConfig: ConnectorConfig = {
    id: dsRow.id,
    orgId: dsRow.orgId,
    type: dsRow.type as ConnectorType,
    name: dsRow.name,
    configEncrypted: dsRow.configEncrypted,
    createdAt: dsRow.createdAt,
    updatedAt: dsRow.updatedAt,
  };

  return createConnector(connectorConfig);
}
