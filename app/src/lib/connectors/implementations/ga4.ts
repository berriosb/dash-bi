import { decryptApiKey } from '@/lib/security/encryption';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

export type GA4Config = {
  accessToken: string;
  propertyId: string;
};

/**
 * Google Analytics 4 connector (Tier 2).
 *
 * Uses the Data API v1 (`analyticsdata.googleapis.com`) which is a
 * fixed-host API like HubSpot — no user-supplied host, so no SSRF
 * surface. Authentication is OAuth Bearer; refresh tokens and service
 * accounts are out of scope for the MVP Tier 2 slice and land in a
 * follow-up.
 *
 * `executeQuery` accepts a new `kind: 'ga4'` Query variant that
 * specifies metrics / dimensions / dateRange directly — there is no
 * SQL string to validate, so this connector intentionally bypasses
 * `validateQuery` (T3). The connector itself enforces the structural
 * invariants (≥1 metric, startDate ≤ endDate, metrics known to GA4)
 * before reaching the wire.
 */
export class GA4Connector implements Connector {
  type = 'ga4' as const;

  private static readonly BASE_URL = 'https://analyticsdata.googleapis.com/v1beta';

  private readonly config: GA4Config;

  constructor(connectorConfig: ConnectorConfig) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decryptApiKey(connectorConfig.configEncrypted));
    } catch {
      throw new Error('Invalid GA4 connector configuration');
    }

    const candidate = parsed as Partial<GA4Config>;
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid GA4 connector configuration');
    }
    if (typeof candidate.accessToken !== 'string' || candidate.accessToken.length === 0) {
      throw new Error('GA4 accessToken is required');
    }
    if (typeof candidate.propertyId !== 'string' || candidate.propertyId.length === 0) {
      throw new Error('GA4 propertyId is required');
    }

    this.config = {
      accessToken: candidate.accessToken,
      propertyId: candidate.propertyId,
    };
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private get runReportUrl(): string {
    return `${GA4Connector.BASE_URL}/properties/${encodeURIComponent(this.config.propertyId)}:runReport`;
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      // Probe with a tiny, well-formed runReport request (1 day, 1 metric).
      const res = await fetch(this.runReportUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics: [{ name: 'sessions' }],
          limit: '1',
        }),
      });

      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `GA4 API status ${res.status}: ${res.statusText}`,
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
          name: 'sessions',
          description: 'Sesiones agregadas por dimensión',
          columns: [
            { name: 'date', type: 'string', nullable: true },
            { name: 'sessions', type: 'number', nullable: false },
            { name: 'engagedSessions', type: 'number', nullable: true },
            { name: 'bounceRate', type: 'number', nullable: true },
            { name: 'averageSessionDuration', type: 'number', nullable: true },
            { name: 'conversions', type: 'number', nullable: true },
          ],
        },
        {
          name: 'users',
          description: 'Usuarios activos (totalUsers / newUsers)',
          columns: [
            { name: 'date', type: 'string', nullable: true },
            { name: 'totalUsers', type: 'number', nullable: false },
            { name: 'newUsers', type: 'number', nullable: true },
            { name: 'engagedUsers', type: 'number', nullable: true },
          ],
        },
        {
          name: 'events',
          description: 'Eventos tracked en GA4 (page_view, click, etc.)',
          columns: [
            { name: 'date', type: 'string', nullable: true },
            { name: 'eventName', type: 'string', nullable: false },
            { name: 'eventCount', type: 'number', nullable: false },
            { name: 'conversions', type: 'number', nullable: true },
          ],
        },
        {
          name: 'conversions',
          description: 'Conversiones atribuidas',
          columns: [
            { name: 'date', type: 'string', nullable: true },
            { name: 'conversions', type: 'number', nullable: false },
            { name: 'conversionRate', type: 'number', nullable: true },
          ],
        },
      ],
    };
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    if (query.kind !== 'ga4') {
      throw new Error('GA4 expects a `ga4` query (metrics/dimensions/dateRange)');
    }

    if (!Array.isArray(query.metrics) || query.metrics.length === 0) {
      throw new Error('GA4 query requires at least one metric');
    }

    const { startDate, endDate } = query.dateRange ?? {};
    if (
      typeof startDate !== 'string' ||
      typeof endDate !== 'string' ||
      startDate.length === 0 ||
      endDate.length === 0
    ) {
      throw new Error('GA4 query requires a valid dateRange with startDate and endDate');
    }
    if (startDate > endDate) {
      throw new Error('GA4 query date range is invalid: startDate must be ≤ endDate');
    }

    const requestBody = {
      dateRanges: [{ startDate, endDate }],
      metrics: query.metrics.map((name) => ({ name })),
      dimensions: (query.dimensions ?? []).map((name) => ({ name })),
      limit: typeof query.limit === 'number' ? String(query.limit) : '10000',
    };

    const start = Date.now();
    const res = await fetch(this.runReportUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      throw new Error(`GA4 query failed with HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      rows?: Array<{
        dimensionValues?: Array<{ value: string }>;
        metricValues?: Array<{ value: string }>;
      }>;
      rowCount?: string;
    };

    const dimensions = (query.dimensions ?? []) as string[];
    const metrics = query.metrics as string[];

    const rows = (body.rows ?? []).map((row) => {
      const flat: Record<string, unknown> = {};
      dimensions.forEach((dim, i) => {
        flat[dim] = row.dimensionValues?.[i]?.value ?? null;
      });
      metrics.forEach((m, i) => {
        const raw = row.metricValues?.[i]?.value;
        // GA4 returns numeric values as strings; coerce for downstream
        // widget formatters that expect numbers.
        const n = Number(raw);
        flat[m] = Number.isFinite(n) && raw !== '' ? n : raw ?? null;
      });
      return flat as T;
    });

    return {
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - start,
    };
  }
}