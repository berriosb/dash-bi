import { decryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

export type HubspotConfig = {
  accessToken: string;
  portalId?: string;
};

/**
 * HubSpot CRM connector (Tier 2).
 *
 * HubSpot's API host is fixed (`api.hubapi.com`), so unlike the
 * Shopify/Postgres/MySQL connectors we do NOT validate a user-supplied
 * hostname — there is no SSRF surface. The only user input is the
 * Private App access token, which is encrypted at rest (BYOK, T4) and
 * never logged or echoed in error messages (T5/T8).
 *
 * Resources exposed: `contacts`, `companies`, `deals`. SQL syntax is
 * SELECT-only (`FROM <resource>`), mirroring the Shopify shape — the
 * `validateQuery` guard rejects DML/DDL.
 */
export class HubspotConnector implements Connector {
  type = 'hubspot' as const;

  private static readonly BASE_URL = 'https://api.hubapi.com/crm/v3';

  private readonly config: HubspotConfig;

  constructor(connectorConfig: ConnectorConfig) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decryptApiKey(connectorConfig.configEncrypted));
    } catch {
      throw new Error('Invalid Hubspot connector configuration');
    }

    const candidate = parsed as Partial<HubspotConfig>;
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid Hubspot connector configuration');
    }
    if (typeof candidate.accessToken !== 'string' || candidate.accessToken.length === 0) {
      throw new Error('Hubspot accessToken is required');
    }

    this.config = {
      accessToken: candidate.accessToken,
      portalId: typeof candidate.portalId === 'string' ? candidate.portalId : undefined,
    };
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await fetch(
        `${HubspotConnector.BASE_URL}/objects/contacts?limit=1`,
        { headers: this.headers },
      );
      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Hubspot API status ${res.status}: ${res.statusText}`,
        };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, error: msg };
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    return {
      tables: [
        {
          name: 'contacts',
          description: 'Contactos del CRM HubSpot',
          columns: [
            { name: 'id', type: 'string', nullable: false },
            { name: 'email', type: 'string', nullable: true },
            { name: 'firstname', type: 'string', nullable: true },
            { name: 'lastname', type: 'string', nullable: true },
            { name: 'phone', type: 'string', nullable: true },
            { name: 'company', type: 'string', nullable: true },
            { name: 'lifecyclestage', type: 'string', nullable: true },
            { name: 'createdate', type: 'datetime', nullable: true },
            { name: 'lastmodifieddate', type: 'datetime', nullable: true },
          ],
        },
        {
          name: 'companies',
          description: 'Empresas (companies) del CRM HubSpot',
          columns: [
            { name: 'id', type: 'string', nullable: false },
            { name: 'name', type: 'string', nullable: true },
            { name: 'domain', type: 'string', nullable: true },
            { name: 'industry', type: 'string', nullable: true },
            { name: 'numberofemployees', type: 'number', nullable: true },
            { name: 'annualrevenue', type: 'number', nullable: true },
            { name: 'city', type: 'string', nullable: true },
            { name: 'country', type: 'string', nullable: true },
            { name: 'createdate', type: 'datetime', nullable: true },
          ],
        },
        {
          name: 'deals',
          description: 'Oportunidades (deals) del pipeline de ventas',
          columns: [
            { name: 'id', type: 'string', nullable: false },
            { name: 'dealname', type: 'string', nullable: true },
            { name: 'amount', type: 'number', nullable: true },
            { name: 'dealstage', type: 'string', nullable: true },
            { name: 'pipeline', type: 'string', nullable: true },
            { name: 'closedate', type: 'datetime', nullable: true },
            { name: 'hubspot_owner_id', type: 'string', nullable: true },
            { name: 'createdate', type: 'datetime', nullable: true },
          ],
        },
      ],
    };
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    validateQuery(query, 'hubspot');

    const start = Date.now();
    const resource = this.resolveResource(query);
    const properties = this.propertiesFor(resource);

    const url = new URL(`${HubspotConnector.BASE_URL}/objects/${resource}`);
    url.searchParams.set('limit', '100');
    if (properties.length > 0) {
      url.searchParams.set('properties', properties.join(','));
    }

    const res = await fetch(url.toString(), { headers: this.headers });

    if (!res.ok) {
      throw new Error(`Hubspot query failed with HTTP ${res.status}`);
    }

    const body = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const rawResults = body.results ?? [];

    // Flatten Hubspot's `properties` bag into the row root so downstream
    // SELECT * / column projection works against plain field names.
    const rows = rawResults.map((r) => {
      const props = (r.properties as Record<string, unknown> | undefined) ?? {};
      return { id: r.id, ...props, createdAt: r.createdAt, updatedAt: r.updatedAt, archived: r.archived } as T;
    });

    return {
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - start,
    };
  }

  private resolveResource(query: Query): 'contacts' | 'companies' | 'deals' {
    if (query.kind !== 'sql') {
      // validateQuery() above would already have rejected this; the
      // `never` guard keeps the union exhaustiveness for the compiler.
      throw new Error('Hubspot expects a SQL query with FROM <resource>');
    }
    const sql = query.sql.toLowerCase();
    if (/\bfrom\s+contacts\b/.test(sql)) return 'contacts';
    if (/\bfrom\s+companies\b/.test(sql)) return 'companies';
    if (/\bfrom\s+deals\b/.test(sql)) return 'deals';
    throw new Error('Unsupported Hubspot resource (expected contacts, companies or deals)');
  }

  private propertiesFor(resource: 'contacts' | 'companies' | 'deals'): string[] {
    switch (resource) {
      case 'contacts':
        return ['email', 'firstname', 'lastname', 'phone', 'company', 'lifecyclestage', 'createdate', 'lastmodifieddate'];
      case 'companies':
        return ['name', 'domain', 'industry', 'numberofemployees', 'annualrevenue', 'city', 'country', 'createdate'];
      case 'deals':
        return ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'hubspot_owner_id', 'createdate'];
    }
  }
}