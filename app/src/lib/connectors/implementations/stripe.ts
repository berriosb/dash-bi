import Stripe from 'stripe';
import { decryptApiKey } from '@/lib/security/encryption';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult, StripeOperation } from '../types';

export type StripeConfig = {
  apiKey: string;
  accountId?: string;
};

const STRIPE_SCHEMA: ConnectorSchema = {
  tables: [
    {
      name: 'charges',
      description: 'Pagos procesados',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'amount', type: 'number', description: 'En centavos' },
        { name: 'currency', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'created', type: 'datetime' },
        { name: 'customer_id', type: 'string' },
      ],
    },
    {
      name: 'subscriptions',
      description: 'Suscripciones recurrentes',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'current_period_start', type: 'datetime' },
        { name: 'current_period_end', type: 'datetime' },
        { name: 'customer_id', type: 'string' },
        { name: 'plan_id', type: 'string' },
        { name: 'amount', type: 'number' },
      ],
    },
    {
      name: 'customers',
      description: 'Clientes',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'created', type: 'datetime' },
      ],
    },
    {
      name: 'invoices',
      description: 'Facturas',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'amount_due', type: 'number' },
        { name: 'amount_paid', type: 'number' },
        { name: 'status', type: 'string' },
        { name: 'created', type: 'datetime' },
        { name: 'customer_id', type: 'string' },
      ],
    },
  ],
};

export class StripeConnector implements Connector {
  type = 'stripe' as const;
  private client: Stripe;

  constructor(connectorConfig: ConnectorConfig) {
    const raw = decryptApiKey(connectorConfig.configEncrypted);
    const config = JSON.parse(raw) as StripeConfig;
    this.client = new Stripe(config.apiKey, {
      apiVersion: '2025-09-30.clover' as never,
    });
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.client.customers.list({ limit: 1 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, error: msg };
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    return STRIPE_SCHEMA;
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    if (query.kind !== 'stripe') {
      throw new Error('Stripe connector only supports stripe operations');
    }

    const op = query.operation as StripeOperation;
    const start = Date.now();

    switch (op.type) {
      case 'listCharges': {
        const charges = await this.client.charges.list(op.params);
        const rows = charges.data.map((c) => ({
          id: c.id,
          amount: c.amount,
          currency: c.currency,
          status: c.status,
          created: new Date(c.created * 1000).toISOString(),
          customer_id: typeof c.customer === 'string' ? c.customer : c.customer?.id,
        }));
        return {
          rows: rows as T[],
          rowCount: rows.length,
          executionTimeMs: Date.now() - start,
        };
      }

      case 'listSubscriptions': {
        const subs = await this.client.subscriptions.list(op.params);
        const rows = subs.data.map((s) => ({
          id: s.id,
          status: s.status,
          current_period_start: new Date(s.current_period_start * 1000).toISOString(),
          current_period_end: new Date(s.current_period_end * 1000).toISOString(),
          customer_id: typeof s.customer === 'string' ? s.customer : s.customer.id,
          plan_id: s.items.data[0]?.price.id,
          amount: s.items.data[0]?.price.unit_amount || 0,
        }));
        return {
          rows: rows as T[],
          rowCount: rows.length,
          executionTimeMs: Date.now() - start,
        };
      }

      case 'listCustomers': {
        const customers = await this.client.customers.list(op.params);
        const rows = customers.data.map((c) => ({
          id: c.id,
          email: c.email,
          name: c.name,
          created: new Date(c.created * 1000).toISOString(),
        }));
        return {
          rows: rows as T[],
          rowCount: rows.length,
          executionTimeMs: Date.now() - start,
        };
      }

      case 'listInvoices': {
        const invoices = await this.client.invoices.list(op.params);
        const rows = invoices.data.map((i) => ({
          id: i.id,
          amount_due: i.amount_due,
          amount_paid: i.amount_paid,
          status: i.status,
          created: new Date(i.created * 1000).toISOString(),
          customer_id: typeof i.customer === 'string' ? i.customer : i.customer?.id,
        }));
        return {
          rows: rows as T[],
          rowCount: rows.length,
          executionTimeMs: Date.now() - start,
        };
      }

      case 'getRevenue': {
        const now = Math.floor(Date.now() / 1000);
        const periodSeconds = {
          day: 86400,
          week: 604800,
          month: 2592000,
          year: 31536000,
        }[op.params.period];

        const since = now - periodSeconds * op.params.count;
        const charges = await this.client.charges.list({
          created: { gte: since },
          limit: 100,
        });

        const buckets = new Map<string, number>();
        for (const charge of charges.data) {
          if (charge.status !== 'succeeded') continue;
          const date = new Date(charge.created * 1000);
          const key = bucketKey(date, op.params.period);
          buckets.set(key, (buckets.get(key) || 0) + charge.amount);
        }

        const rows = Array.from(buckets.entries())
          .map(([period, amount]) => ({
            period,
            amount: amount / 100, // cents to dollars
          }))
          .sort((a, b) => a.period.localeCompare(b.period));

        return {
          rows: rows as T[],
          rowCount: rows.length,
          executionTimeMs: Date.now() - start,
        };
      }
    }
  }
}

function bucketKey(date: Date, period: 'day' | 'week' | 'month' | 'year'): string {
  switch (period) {
    case 'day':
      return date.toISOString().slice(0, 10);
    case 'week': {
      const d = new Date(date);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    }
    case 'month':
      return date.toISOString().slice(0, 7);
    case 'year':
      return date.toISOString().slice(0, 4);
  }
}
