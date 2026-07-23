import { eq, and } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { dataSources } from '@/db/schema';
import { createConnector } from '@/lib/connectors/registry';
import type { Connector, ConnectorConfig, ConnectorType } from '@/lib/connectors/types';
import type { OrgRole } from '@/lib/auth/permissions';

export class DataSourceNotFoundError extends Error {
  constructor(public dataSourceId: string) {
    super(`DataSource not found: ${dataSourceId}`);
    this.name = 'DataSourceNotFoundError';
  }
}

/**
 * Resuelve el connector para un data source.
 *
 * Sprint 1: acepta `role` opcional para que query-engine pueda aplicar
 * filtros row-level (PII masking para viewer).
 */
export async function resolveConnector(
  orgId: string,
  userId: string,
  dataSourceId: string,
  role?: OrgRole,
): Promise<Connector> {
  const fetchFn = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const rows = await tx
      .select()
      .from(dataSources)
      .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.orgId, orgId)));
    return rows[0] ?? null;
  };

  const dsRow = role
    ? await withOrgContext(orgId, userId, role, fetchFn)
    : await withOrgContext(orgId, userId, fetchFn);

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

  const connector = createConnector(connectorConfig);

  // Si el connector implementa setRole, propagarlo para filtros adicionales.
  // (defense in depth; los connectors existentes lo ignoran si no lo exponen)
  if (role && 'setRole' in connector && typeof (connector as { setRole?: unknown }).setRole === 'function') {
    (connector as unknown as { setRole: (r: OrgRole) => void }).setRole(role);
  }

  return connector;
}
