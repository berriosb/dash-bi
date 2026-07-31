import { decryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';
import { validatePostgresHost, SSRFError } from '@/lib/security/validate-connection';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

export type ShopifyConfig = {
  shopUrl: string;
  accessToken: string;
  apiVersion?: string;
};

export class ShopifyConnector implements Connector {
  type = 'shopify' as const;
  private config: ShopifyConfig;

  constructor(connectorConfig: ConnectorConfig) {
    const rawConfig = decryptApiKey(connectorConfig.configEncrypted);
    this.config = JSON.parse(rawConfig);

    if (!this.config.shopUrl) {
      throw new SSRFError('Shopify shopUrl is required');
    }

    const host = this.config.shopUrl.replace(/^https?:\/\//, '').split('/')[0] ?? '';
    try {
      validatePostgresHost(host);
    } catch (err) {
      if (err instanceof SSRFError) {
        throw err;
      }
      throw new SSRFError(`Invalid Shopify host: ${(err as Error).message}`);
    }

    this.config.shopUrl = host;
  }

  private get apiVersion(): string {
    return this.config.apiVersion ?? '2024-01';
  }

  private get baseUrl(): string {
    return `https://${this.config.shopUrl}/admin/api/${this.apiVersion}`;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': this.config.accessToken,
    };
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/shop.json`, {
        headers: this.headers,
      });

      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Shopify API status ${res.status}: ${res.statusText}`,
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
          name: 'orders',
          description: 'Órdenes de compra de la tienda Shopify',
          columns: [
            { name: 'id', type: 'number', nullable: false },
            { name: 'order_number', type: 'number', nullable: false },
            { name: 'total_price', type: 'string', nullable: false },
            { name: 'subtotal_price', type: 'string', nullable: true },
            { name: 'total_tax', type: 'string', nullable: true },
            { name: 'currency', type: 'string', nullable: false },
            { name: 'financial_status', type: 'string', nullable: true },
            { name: 'fulfillment_status', type: 'string', nullable: true },
            { name: 'created_at', type: 'datetime', nullable: false },
          ],
        },
        {
          name: 'products',
          description: 'Catálogo de productos e inventario',
          columns: [
            { name: 'id', type: 'number', nullable: false },
            { name: 'title', type: 'string', nullable: false },
            { name: 'vendor', type: 'string', nullable: true },
            { name: 'product_type', type: 'string', nullable: true },
            { name: 'status', type: 'string', nullable: true },
            { name: 'created_at', type: 'datetime', nullable: false },
          ],
        },
        {
          name: 'customers',
          description: 'Base de clientes registrados y compradores',
          columns: [
            { name: 'id', type: 'number', nullable: false },
            { name: 'first_name', type: 'string', nullable: true },
            { name: 'last_name', type: 'string', nullable: true },
            { name: 'email', type: 'string', nullable: true },
            { name: 'orders_count', type: 'number', nullable: false },
            { name: 'total_spent', type: 'string', nullable: false },
            { name: 'created_at', type: 'datetime', nullable: false },
          ],
        },
      ],
    };
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    validateQuery(query, 'shopify');

    const start = Date.now();
    let resource = 'orders';

    if (query.kind === 'sql') {
      const sqlLower = query.sql.toLowerCase();
      if (sqlLower.includes('from products')) resource = 'products';
      else if (sqlLower.includes('from customers')) resource = 'customers';
    }

    const res = await fetch(`${this.baseUrl}/${resource}.json?limit=250`, {
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`Shopify query failed with HTTP ${res.status}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const rawRows = (body[resource] as T[]) ?? [];

    return {
      rows: rawRows,
      rowCount: rawRows.length,
      executionTimeMs: Date.now() - start,
    };
  }
}
